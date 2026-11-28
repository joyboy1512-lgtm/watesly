"""Facebook Messenger: connect Page accounts, inbound DMs, outbound replies."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.encryption import decrypt_secret, encrypt_secret
from app.models.channel import Channel, ChannelStatus, ChannelType
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.messenger_account import MessengerAccount, MessengerAccountStatus
from app.models.message import Message, MessageDirection, MessageStatus, MessageType
from app.models.organization import Organization
from app.models.webhook_event import WebhookEvent, WebhookEventStatus
from app.realtime.event_bus import publish_event
from app.schemas.messenger import MessengerAccountCreateRequest
from app.services.feature_flags import get_feature_flags
from app.services.meta_client import MetaAPIError
from app.services.meta_instagram import MetaInstagramClient

logger = logging.getLogger(__name__)


def messenger_webhook_callback_url() -> str:
    base = settings.public_api_base_url.rstrip("/")
    return f"{base}/api/v1/messenger/webhook"


def _account_to_dict(
    item: MessengerAccount,
    *,
    channel_name: str | None = None,
    organization_name: str | None = None,
) -> dict:
    return {
        "id": item.id,
        "channel_id": item.channel_id,
        "organization_id": item.organization_id,
        "channel_name": channel_name,
        "organization_name": organization_name,
        "page_id": item.page_id,
        "page_name": item.page_name,
        "status": item.status,
        "webhook_subscribed_at": item.webhook_subscribed_at,
        "meta_status_message": item.meta_status_message,
        "created_at": item.created_at,
    }


async def list_messenger_accounts(
    db: AsyncSession, account_id: UUID
) -> list[tuple[MessengerAccount, str | None, str | None]]:
    result = await db.execute(
        select(MessengerAccount, Channel.name, Organization.name)
        .join(Channel, MessengerAccount.channel_id == Channel.id)
        .join(Organization, MessengerAccount.organization_id == Organization.id)
        .where(
            MessengerAccount.account_id == account_id,
            Channel.deleted_at.is_(None),
        )
        .order_by(MessengerAccount.created_at.asc())
    )
    return list(result.all())


async def create_messenger_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: MessengerAccountCreateRequest,
) -> MessengerAccount:
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("messenger_channel"):
        raise ValueError("MESSENGER_FLAG_DISABLED")

    channel = await db.get(Channel, payload.channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("INVALID_CHANNEL")
    if channel.type != ChannelType.MESSENGER:
        raise ValueError("CHANNEL_NOT_MESSENGER")

    existing = (
        await db.execute(select(MessengerAccount).where(MessengerAccount.channel_id == channel.id))
    ).scalar_one_or_none()

    client = MetaInstagramClient(
        access_token=payload.access_token,
        page_id=payload.page_id.strip(),
    )
    try:
        profile = await client._request(
            "GET",
            f"{client._base}/{payload.page_id.strip()}",
            params={"fields": "id,name"},
        )
    except MetaAPIError as exc:
        await client.aclose()
        raise ValueError("INVALID_ACCESS_TOKEN") from exc

    page_id = str(profile.get("id") or payload.page_id).strip()
    page_name = profile.get("name") if isinstance(profile, dict) else payload.page_name
    page_name = page_name or payload.page_name

    conflict_q = select(MessengerAccount).where(MessengerAccount.page_id == page_id)
    if existing is not None:
        conflict_q = conflict_q.where(MessengerAccount.id != existing.id)
    conflict = (await db.execute(conflict_q)).scalar_one_or_none()
    if conflict is not None and conflict.account_id != account_id:
        await client.aclose()
        raise ValueError("PAGE_ALREADY_CONNECTED")

    webhook_error: str | None = None
    try:
        await client.subscribe_page_webhooks()
        subscribed_at = datetime.now(UTC)
    except MetaAPIError as exc:
        logger.warning("Messenger page webhook subscribe failed: %s", exc)
        webhook_error = str(exc)
        subscribed_at = None
    finally:
        await client.aclose()

    if existing is not None:
        item = existing
        item.page_id = page_id
        item.page_name = page_name
        item.access_token_encrypted = encrypt_secret(payload.access_token)
        item.status = MessengerAccountStatus.ACTIVE
        item.webhook_subscribed_at = subscribed_at
        item.meta_status_message = webhook_error
    else:
        item = MessengerAccount(
            account_id=account_id,
            organization_id=channel.organization_id,
            channel_id=channel.id,
            page_id=page_id,
            page_name=page_name,
            access_token_encrypted=encrypt_secret(payload.access_token),
            status=MessengerAccountStatus.ACTIVE,
            webhook_subscribed_at=subscribed_at,
            meta_status_message=webhook_error,
        )
        db.add(item)

    channel.status = ChannelStatus.ACTIVE
    channel.external_id = page_id
    await db.commit()
    await db.refresh(item)
    return item


async def disconnect_messenger_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    messenger_account_id: UUID,
) -> MessengerAccount:
    item = await db.get(MessengerAccount, messenger_account_id)
    if item is None or item.account_id != account_id:
        raise ValueError("MESSENGER_ACCOUNT_NOT_FOUND")
    item.status = MessengerAccountStatus.DISCONNECTED
    channel = await db.get(Channel, item.channel_id)
    if channel is not None and channel.account_id == account_id:
        channel.status = ChannelStatus.DISCONNECTED
    await db.commit()
    await db.refresh(item)
    return item


async def _get_or_create_contact_and_conversation(
    db: AsyncSession,
    *,
    messenger_account: MessengerAccount,
    sender: str,
    display_name: str | None,
) -> tuple[Contact, Conversation, bool]:
    from app.services.assignments import auto_assign_conversation

    sender = str(sender).strip()
    if not sender:
        raise ValueError("INVALID_SENDER")

    result = await db.execute(
        select(Contact).where(
            Contact.organization_id == messenger_account.organization_id,
            Contact.channel_id == messenger_account.channel_id,
            Contact.external_address == sender,
            Contact.deleted_at.is_(None),
        )
    )
    contact = result.scalar_one_or_none()
    created_conversation = False
    if contact is None:
        contact = Contact(
            account_id=messenger_account.account_id,
            organization_id=messenger_account.organization_id,
            channel_id=messenger_account.channel_id,
            external_address=sender,
            display_name=display_name,
        )
        db.add(contact)
        await db.flush()

    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.contact_id == contact.id,
            Conversation.channel_id == messenger_account.channel_id,
            Conversation.status == ConversationStatus.OPEN,
            Conversation.deleted_at.is_(None),
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        conversation = Conversation(
            account_id=messenger_account.account_id,
            organization_id=messenger_account.organization_id,
            channel_id=messenger_account.channel_id,
            contact_id=contact.id,
            status=ConversationStatus.OPEN,
        )
        db.add(conversation)
        await db.flush()
        created_conversation = True
        await auto_assign_conversation(db, conversation=conversation)

    if display_name and not contact.display_name:
        contact.display_name = display_name

    return contact, conversation, created_conversation


async def send_messenger_text_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    messenger_account_id: UUID,
    to: str,
    text: str,
    record_mac: bool = False,
) -> Message:
    item = await db.get(MessengerAccount, messenger_account_id)
    if item is None or item.account_id != account_id or item.status != MessengerAccountStatus.ACTIVE:
        raise ValueError("MESSENGER_ACCOUNT_NOT_AVAILABLE")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db,
        messenger_account=item,
        sender=to,
        display_name=None,
    )

    token = decrypt_secret(item.access_token_encrypted)
    client = MetaInstagramClient(access_token=token, page_id=item.page_id)
    try:
        provider = await client.send_text(to=to, text=text)
    finally:
        await client.aclose()

    external_id = None
    if isinstance(provider, dict):
        external_id = provider.get("message_id") or (provider.get("message", {}) or {}).get("mid")

    message = Message(
        account_id=account_id,
        organization_id=item.organization_id,
        channel_id=item.channel_id,
        conversation_id=conversation.id,
        contact_id=contact.id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.TEXT,
        status=MessageStatus.SENT,
        from_address=item.page_name or item.page_id,
        to_address=to,
        text_body=text,
        external_message_id=str(external_id) if external_id else None,
        provider_payload=provider if isinstance(provider, dict) else {"raw": provider},
    )
    db.add(message)
    conversation.last_message_at = datetime.now(UTC)
    conversation.status = ConversationStatus.OPEN
    await db.commit()
    await db.refresh(message)

    if record_mac:
        from app.models.monthly_active_contact import MacTriggerSource
        from app.services.mac_usage import record_mac

        await record_mac(
            db,
            account_id=account_id,
            channel_id=item.channel_id,
            contact_id=contact.id,
            trigger_source=MacTriggerSource.INBOX_OUTBOUND,
        )

    return message


async def process_messenger_webhook(db: AsyncSession, payload: dict) -> dict[str, int]:
    """Handle Meta Messenger webhooks (object=page)."""
    processed = 0
    entries = payload.get("entry") or []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        page_id = str(entry.get("id") or "")
        messaging_events = entry.get("messaging") or []
        messenger_account = None
        if page_id:
            messenger_account = (
                await db.execute(select(MessengerAccount).where(MessengerAccount.page_id == page_id))
            ).scalars().first()

        for event in messaging_events:
            if not isinstance(event, dict):
                continue
            message = event.get("message") or {}
            if not isinstance(message, dict):
                continue
            if message.get("is_echo"):
                continue
            sender = (event.get("sender") or {}).get("id")
            if not sender:
                continue
            if messenger_account is None:
                recipient = str((event.get("recipient") or {}).get("id") or "")
                if recipient:
                    messenger_account = (
                        await db.execute(
                            select(MessengerAccount).where(MessengerAccount.page_id == recipient)
                        )
                    ).scalars().first()
            if messenger_account is None or messenger_account.status != MessengerAccountStatus.ACTIVE:
                db.add(
                    WebhookEvent(
                        provider="meta_messenger",
                        event_type="messenger_message_unmatched",
                        payload={"entry": entry, "messaging": event},
                        status=WebhookEventStatus.IGNORED,
                    )
                )
                continue

            mid = message.get("mid")
            if mid:
                dup = await db.execute(select(Message.id).where(Message.external_message_id == str(mid)))
                if dup.scalar_one_or_none() is not None:
                    continue

            text = message.get("text")
            msg_type = MessageType.TEXT
            if not text and message.get("attachments"):
                text = "[مرفق Messenger]"
                msg_type = MessageType.IMAGE

            display_name = None
            try:
                token = decrypt_secret(messenger_account.access_token_encrypted)
                client = MetaInstagramClient(
                    access_token=token,
                    page_id=messenger_account.page_id,
                )
                try:
                    profile = await client.get_user_profile(str(sender))
                    display_name = profile.get("name") or profile.get("first_name")
                finally:
                    await client.aclose()
            except Exception:
                logger.debug("Could not fetch Messenger user profile for %s", sender)

            contact, conversation, _created = await _get_or_create_contact_and_conversation(
                db,
                messenger_account=messenger_account,
                sender=str(sender),
                display_name=display_name,
            )
            inbound = Message(
                account_id=messenger_account.account_id,
                organization_id=messenger_account.organization_id,
                channel_id=messenger_account.channel_id,
                conversation_id=conversation.id,
                contact_id=contact.id,
                direction=MessageDirection.INBOUND,
                type=msg_type,
                status=MessageStatus.RECEIVED,
                from_address=str(sender),
                to_address=messenger_account.page_id,
                text_body=text,
                external_message_id=str(mid) if mid else None,
                provider_payload=event,
            )
            db.add(inbound)
            conversation.last_message_at = datetime.now(UTC)
            conversation.status = ConversationStatus.OPEN
            contact.last_inbound_at = datetime.now(UTC)
            processed += 1
            await db.flush()
            await publish_event(
                messenger_account.account_id,
                {
                    "type": "message.received",
                    "conversation_id": str(conversation.id),
                    "message_id": str(inbound.id),
                },
            )

    if processed:
        await db.commit()
    return {"processed": processed}
