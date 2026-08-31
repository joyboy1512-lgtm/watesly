"""Instagram Messaging: connect Page-linked IG accounts, inbound DMs, outbound replies."""

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
from app.models.instagram_account import InstagramAccount, InstagramAccountStatus
from app.models.message import Message, MessageDirection, MessageStatus, MessageType
from app.models.organization import Organization
from app.models.webhook_event import WebhookEvent, WebhookEventStatus
from app.realtime.event_bus import publish_event
from app.schemas.instagram import InstagramAccountCreateRequest
from app.services.meta_client import MetaAPIError
from app.services.meta_instagram import MetaInstagramClient

logger = logging.getLogger(__name__)


def instagram_webhook_callback_url() -> str:
    base = settings.public_api_base_url.rstrip("/")
    return f"{base}/api/v1/instagram/webhook"


def _account_to_dict(
    item: InstagramAccount,
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
        "ig_user_id": item.ig_user_id,
        "username": item.username,
        "page_name": item.page_name,
        "status": item.status,
        "webhook_subscribed_at": item.webhook_subscribed_at,
        "meta_status_message": item.meta_status_message,
        "created_at": item.created_at,
    }


async def list_instagram_accounts(
    db: AsyncSession, account_id: UUID
) -> list[tuple[InstagramAccount, str | None, str | None]]:
    result = await db.execute(
        select(InstagramAccount, Channel.name, Organization.name)
        .join(Channel, InstagramAccount.channel_id == Channel.id)
        .join(Organization, InstagramAccount.organization_id == Organization.id)
        .where(
            InstagramAccount.account_id == account_id,
            Channel.deleted_at.is_(None),
        )
        .order_by(InstagramAccount.created_at.asc())
    )
    return list(result.all())


async def create_instagram_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: InstagramAccountCreateRequest,
) -> InstagramAccount:
    channel = await db.get(Channel, payload.channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("INVALID_CHANNEL")
    if channel.type != ChannelType.INSTAGRAM:
        raise ValueError("CHANNEL_NOT_INSTAGRAM")

    existing = (
        await db.execute(
            select(InstagramAccount).where(InstagramAccount.channel_id == channel.id)
        )
    ).scalar_one_or_none()

    client = MetaInstagramClient(
        access_token=payload.access_token,
        page_id=payload.page_id.strip(),
        ig_user_id=payload.ig_user_id,
    )
    try:
        profile = await client.get_page_instagram_profile()
    except MetaAPIError as exc:
        raise ValueError("INVALID_ACCESS_TOKEN") from exc

    ig_node = profile.get("instagram_business_account") if isinstance(profile, dict) else None
    if not isinstance(ig_node, dict) or not ig_node.get("id"):
        if not payload.ig_user_id:
            await client.aclose()
            raise ValueError("INSTAGRAM_NOT_LINKED_TO_PAGE")
        ig_user_id = payload.ig_user_id.strip()
        username = payload.username
        page_name = payload.page_name or profile.get("name") if isinstance(profile, dict) else payload.page_name
    else:
        ig_user_id = str(ig_node["id"])
        username = ig_node.get("username") or payload.username
        page_name = profile.get("name") if isinstance(profile, dict) else payload.page_name

    page_id = str(profile.get("id") or payload.page_id).strip()

    conflict_q = select(InstagramAccount).where(InstagramAccount.ig_user_id == ig_user_id)
    if existing is not None:
        conflict_q = conflict_q.where(InstagramAccount.id != existing.id)
    conflict = (await db.execute(conflict_q)).scalar_one_or_none()
    if conflict is not None and conflict.account_id != account_id:
        await client.aclose()
        raise ValueError("IG_ACCOUNT_ALREADY_CONNECTED")

    webhook_error: str | None = None
    try:
        await client.subscribe_page_webhooks()
        subscribed_at = datetime.now(UTC)
    except MetaAPIError as exc:
        logger.warning("Instagram page webhook subscribe failed: %s", exc)
        webhook_error = str(exc)
        subscribed_at = None
    finally:
        await client.aclose()

    if existing is not None:
        item = existing
        item.page_id = page_id
        item.ig_user_id = ig_user_id
        item.username = username
        item.page_name = page_name
        item.access_token_encrypted = encrypt_secret(payload.access_token)
        item.status = InstagramAccountStatus.ACTIVE
        item.webhook_subscribed_at = subscribed_at
        item.meta_status_message = webhook_error
    else:
        item = InstagramAccount(
            account_id=account_id,
            organization_id=channel.organization_id,
            channel_id=channel.id,
            page_id=page_id,
            ig_user_id=ig_user_id,
            username=username,
            page_name=page_name,
            access_token_encrypted=encrypt_secret(payload.access_token),
            status=InstagramAccountStatus.ACTIVE,
            webhook_subscribed_at=subscribed_at,
            meta_status_message=webhook_error,
        )
        db.add(item)

    channel.status = ChannelStatus.ACTIVE
    channel.external_id = ig_user_id
    await db.commit()
    await db.refresh(item)
    return item


async def disconnect_instagram_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    instagram_account_id: UUID,
) -> InstagramAccount:
    item = await db.get(InstagramAccount, instagram_account_id)
    if item is None or item.account_id != account_id:
        raise ValueError("INSTAGRAM_ACCOUNT_NOT_FOUND")
    item.status = InstagramAccountStatus.DISCONNECTED
    channel = await db.get(Channel, item.channel_id)
    if channel is not None and channel.account_id == account_id:
        channel.status = ChannelStatus.DISCONNECTED
    await db.commit()
    await db.refresh(item)
    return item


async def send_instagram_text_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    instagram_account_id: UUID,
    to: str,
    text: str,
    record_mac: bool = False,
) -> Message:
    item = await db.get(InstagramAccount, instagram_account_id)
    if (
        item is None
        or item.account_id != account_id
        or item.status != InstagramAccountStatus.ACTIVE
    ):
        raise ValueError("INSTAGRAM_ACCOUNT_NOT_AVAILABLE")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db,
        instagram_account=item,
        sender=to,
        display_name=None,
    )

    token = decrypt_secret(item.access_token_encrypted)
    client = MetaInstagramClient(
        access_token=token,
        page_id=item.page_id,
        ig_user_id=item.ig_user_id,
    )
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
        from_address=item.username or item.ig_user_id,
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


async def _get_or_create_contact_and_conversation(
    db: AsyncSession,
    *,
    instagram_account: InstagramAccount,
    sender: str,
    display_name: str | None,
) -> tuple[Contact, Conversation, bool]:
    from app.services.assignments import auto_assign_conversation

    sender = str(sender).strip()
    if not sender:
        raise ValueError("INVALID_SENDER")

    result = await db.execute(
        select(Contact).where(
            Contact.organization_id == instagram_account.organization_id,
            Contact.channel_id == instagram_account.channel_id,
            Contact.external_address == sender,
            Contact.deleted_at.is_(None),
        )
    )
    contact = result.scalar_one_or_none()
    created_conversation = False
    if contact is None:
        contact = Contact(
            account_id=instagram_account.account_id,
            organization_id=instagram_account.organization_id,
            channel_id=instagram_account.channel_id,
            external_address=sender,
            display_name=display_name,
        )
        db.add(contact)
        await db.flush()

    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.contact_id == contact.id,
            Conversation.channel_id == instagram_account.channel_id,
            Conversation.status == ConversationStatus.OPEN,
            Conversation.deleted_at.is_(None),
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        conversation = Conversation(
            account_id=instagram_account.account_id,
            organization_id=instagram_account.organization_id,
            channel_id=instagram_account.channel_id,
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


async def process_instagram_webhook(db: AsyncSession, payload: dict) -> dict[str, int]:
    """Handle Meta Instagram messaging webhooks (object=instagram)."""
    processed = 0
    entries = payload.get("entry") or []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        ig_id = str(entry.get("id") or "")
        messaging_events = entry.get("messaging") or []
        # Some payloads nest under changes[].value.messaging
        if not messaging_events:
            for change in entry.get("changes") or []:
                if not isinstance(change, dict):
                    continue
                value = change.get("value") or {}
                if isinstance(value, dict) and value.get("messaging"):
                    messaging_events = value.get("messaging") or []

        ig_account = None
        if ig_id:
            ig_account = (
                await db.execute(
                    select(InstagramAccount).where(
                        (InstagramAccount.ig_user_id == ig_id)
                        | (InstagramAccount.page_id == ig_id)
                    )
                )
            ).scalars().first()

        for event in messaging_events:
            if not isinstance(event, dict):
                continue
            message = event.get("message") or {}
            if not isinstance(message, dict):
                continue
            # Skip echoes (outbound from page mirrored back)
            if message.get("is_echo"):
                continue
            sender = (event.get("sender") or {}).get("id")
            if not sender:
                continue
            if ig_account is None:
                recipient = str((event.get("recipient") or {}).get("id") or "")
                if recipient:
                    ig_account = (
                        await db.execute(
                            select(InstagramAccount).where(
                                (InstagramAccount.ig_user_id == recipient)
                                | (InstagramAccount.page_id == recipient)
                            )
                        )
                    ).scalars().first()
            if ig_account is None or ig_account.status != InstagramAccountStatus.ACTIVE:
                event_row = WebhookEvent(
                    provider="meta_instagram",
                    event_type="instagram_message_unmatched",
                    payload={"entry": entry, "messaging": event},
                    status=WebhookEventStatus.IGNORED,
                )
                db.add(event_row)
                continue

            mid = message.get("mid")
            if mid:
                dup = await db.execute(
                    select(Message.id).where(Message.external_message_id == str(mid))
                )
                if dup.scalar_one_or_none() is not None:
                    continue

            text = message.get("text")
            msg_type = MessageType.TEXT
            if not text and message.get("attachments"):
                text = "[مرفق Instagram]"
                msg_type = MessageType.IMAGE

            display_name = None
            try:
                token = decrypt_secret(ig_account.access_token_encrypted)
                client = MetaInstagramClient(
                    access_token=token,
                    page_id=ig_account.page_id,
                    ig_user_id=ig_account.ig_user_id,
                )
                try:
                    profile = await client.get_user_profile(str(sender))
                    display_name = profile.get("name") or profile.get("username")
                finally:
                    await client.aclose()
            except Exception:
                logger.debug("Could not fetch Instagram user profile for %s", sender)

            contact, conversation, created = await _get_or_create_contact_and_conversation(
                db,
                instagram_account=ig_account,
                sender=str(sender),
                display_name=display_name,
            )
            contact.last_inbound_at = datetime.now(UTC)

            inbound = Message(
                account_id=ig_account.account_id,
                organization_id=ig_account.organization_id,
                channel_id=ig_account.channel_id,
                conversation_id=conversation.id,
                contact_id=contact.id,
                direction=MessageDirection.INBOUND,
                type=msg_type,
                status=MessageStatus.RECEIVED,
                from_address=str(sender),
                to_address=ig_account.username or ig_account.ig_user_id,
                text_body=text,
                external_message_id=str(mid) if mid else None,
                provider_payload={"messaging": event},
            )
            db.add(inbound)
            conversation.last_message_at = datetime.now(UTC)
            conversation.status = ConversationStatus.OPEN

            event_row = WebhookEvent(
                provider="meta_instagram",
                account_id=ig_account.account_id,
                channel_id=ig_account.channel_id,
                event_type="instagram_message",
                payload={"entry": entry, "messaging": event},
                status=WebhookEventStatus.PROCESSED,
                processed_at=datetime.now(UTC),
            )
            db.add(event_row)
            await db.flush()
            processed += 1

            from app.models.monthly_active_contact import MacTriggerSource
            from app.services.mac_usage import record_mac

            await record_mac(
                db,
                account_id=ig_account.account_id,
                channel_id=ig_account.channel_id,
                contact_id=contact.id,
                trigger_source=MacTriggerSource.INBOUND,
            )

            await publish_event(
                ig_account.account_id,
                {
                    "type": "message.received",
                    "conversation_id": str(conversation.id),
                    "message_id": str(inbound.id),
                    "channel_type": "instagram",
                    "created_conversation": created,
                },
            )

    await db.commit()
    return {"processed": processed}
