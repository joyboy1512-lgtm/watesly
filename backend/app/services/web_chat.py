"""Web Chat channel: activate widget token, public inbound, inbox outbound."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel, ChannelStatus, ChannelType
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageDirection, MessageStatus, MessageType
from app.realtime.event_bus import publish_event


def _new_widget_token() -> str:
    return secrets.token_urlsafe(24)


async def activate_web_chat_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
) -> Channel:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("INVALID_CHANNEL")
    if channel.type != ChannelType.WEB_CHAT:
        raise ValueError("CHANNEL_NOT_WEB_CHAT")
    if not channel.external_id:
        channel.external_id = _new_widget_token()
    channel.status = ChannelStatus.ACTIVE
    await db.commit()
    await db.refresh(channel)
    return channel


async def get_web_chat_channel_by_token(db: AsyncSession, token: str) -> Channel | None:
    token = (token or "").strip()
    if not token:
        return None
    return (
        await db.execute(
            select(Channel).where(
                Channel.type == ChannelType.WEB_CHAT,
                Channel.external_id == token,
                Channel.status == ChannelStatus.ACTIVE,
                Channel.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def _get_or_create_visitor_conversation(
    db: AsyncSession,
    *,
    channel: Channel,
    visitor_id: str,
    display_name: str | None,
) -> tuple[Contact, Conversation]:
    from app.services.assignments import auto_assign_conversation

    visitor_id = visitor_id.strip()[:120]
    result = await db.execute(
        select(Contact).where(
            Contact.organization_id == channel.organization_id,
            Contact.channel_id == channel.id,
            Contact.external_address == visitor_id,
            Contact.deleted_at.is_(None),
        )
    )
    contact = result.scalar_one_or_none()
    if contact is None:
        contact = Contact(
            account_id=channel.account_id,
            organization_id=channel.organization_id,
            channel_id=channel.id,
            external_address=visitor_id,
            display_name=display_name or f"زائر {visitor_id[-6:]}",
        )
        db.add(contact)
        await db.flush()
    elif display_name and not contact.display_name:
        contact.display_name = display_name

    conv = (
        await db.execute(
            select(Conversation).where(
                Conversation.contact_id == contact.id,
                Conversation.channel_id == channel.id,
                Conversation.status == ConversationStatus.OPEN,
                Conversation.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if conv is None:
        conv = Conversation(
            account_id=channel.account_id,
            organization_id=channel.organization_id,
            channel_id=channel.id,
            contact_id=contact.id,
            status=ConversationStatus.OPEN,
        )
        db.add(conv)
        await db.flush()
        await auto_assign_conversation(db, conversation=conv)
    return contact, conv


async def ingest_web_chat_inbound(
    db: AsyncSession,
    *,
    token: str,
    visitor_id: str,
    text: str,
    display_name: str | None = None,
) -> dict:
    channel = await get_web_chat_channel_by_token(db, token)
    if channel is None:
        raise ValueError("WEB_CHAT_NOT_FOUND")
    text = (text or "").strip()
    if not text:
        raise ValueError("EMPTY_TEXT")
    if not visitor_id.strip():
        raise ValueError("INVALID_VISITOR")

    contact, conversation = await _get_or_create_visitor_conversation(
        db,
        channel=channel,
        visitor_id=visitor_id,
        display_name=display_name,
    )
    message = Message(
        account_id=channel.account_id,
        organization_id=channel.organization_id,
        channel_id=channel.id,
        conversation_id=conversation.id,
        contact_id=contact.id,
        direction=MessageDirection.INBOUND,
        type=MessageType.TEXT,
        status=MessageStatus.RECEIVED,
        from_address=visitor_id.strip()[:80],
        to_address=channel.external_id or "web_chat",
        text_body=text[:4000],
        provider_payload={"source": "web_chat", "visitor_id": visitor_id},
    )
    db.add(message)
    conversation.last_message_at = datetime.now(UTC)
    conversation.status = ConversationStatus.OPEN
    contact.last_inbound_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    await publish_event(
        channel.account_id,
        {
            "type": "message.received",
            "conversation_id": str(conversation.id),
            "message_id": str(message.id),
        },
    )
    return {
        "message_id": str(message.id),
        "conversation_id": str(conversation.id),
        "contact_id": str(contact.id),
    }


async def send_web_chat_text_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel: Channel,
    contact: Contact,
    conversation: Conversation,
    text: str,
) -> Message:
    if channel.type != ChannelType.WEB_CHAT or channel.account_id != account_id:
        raise ValueError("CHANNEL_NOT_WEB_CHAT")
    message = Message(
        account_id=account_id,
        organization_id=channel.organization_id,
        channel_id=channel.id,
        conversation_id=conversation.id,
        contact_id=contact.id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.TEXT,
        status=MessageStatus.SENT,
        from_address=channel.name or "agent",
        to_address=contact.external_address,
        text_body=text,
        provider_payload={"source": "web_chat", "delivered": "stored"},
    )
    db.add(message)
    conversation.last_message_at = datetime.now(UTC)
    conversation.status = ConversationStatus.OPEN
    await db.commit()
    await db.refresh(message)
    return message


async def list_web_chat_messages_for_visitor(
    db: AsyncSession,
    *,
    token: str,
    visitor_id: str,
    after: datetime | None = None,
) -> list[dict]:
    channel = await get_web_chat_channel_by_token(db, token)
    if channel is None:
        raise ValueError("WEB_CHAT_NOT_FOUND")
    contact = (
        await db.execute(
            select(Contact).where(
                Contact.channel_id == channel.id,
                Contact.external_address == visitor_id.strip(),
                Contact.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if contact is None:
        return []
    stmt = (
        select(Message)
        .where(Message.contact_id == contact.id, Message.channel_id == channel.id)
        .order_by(Message.created_at.asc())
        .limit(200)
    )
    if after is not None:
        stmt = stmt.where(Message.created_at > after)
    rows = list((await db.execute(stmt)).scalars().all())
    return [
        {
            "id": str(row.id),
            "direction": row.direction,
            "text": row.text_body,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
