import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret, encrypt_secret
from app.models.channel import Channel, ChannelStatus, ChannelType
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.membership import Membership
from app.models.message import (
    Message,
    MessageDirection,
    MessageStatus,
    MessageType,
)
from app.models.webhook_event import WebhookEvent, WebhookEventStatus
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus, WhatsAppConnectionMethod
from app.services.notifications import create_notification
from app.services.assignments import auto_assign_conversation
from app.realtime.event_bus import publish_event
from app.schemas.whatsapp import SendTextMessageRequest, WhatsAppAccountCreateRequest
from app.schemas.whatsapp_media import SendMediaMessageRequest, SendTemplateMessageRequest
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.whatsapp_window import compute_service_window
from app.models.automation import AutomationTriggerType
from app.services.automation_triggers import queue_automation_runs
from app.services.outbox import add_outbox_event

logger = logging.getLogger(__name__)


async def _record_mac_for_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    contact_id: UUID | None,
    inbound: bool,
    trigger_source: "MacTriggerSource | None" = None,
) -> None:
    """Record MAC once per contact per account per month (see mac_tracking policy)."""
    if contact_id is None:
        return
    from app.models.monthly_active_contact import MacTriggerSource
    from app.services.mac_usage import record_mac

    source = trigger_source or (
        MacTriggerSource.INBOUND if inbound else MacTriggerSource.INBOX_OUTBOUND
    )
    await record_mac(
        db,
        account_id=account_id,
        channel_id=channel_id,
        contact_id=contact_id,
        trigger_source=source,
    )



async def _get_or_create_contact_and_conversation(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
    sender: str,
    display_name: str | None,
) -> tuple[Contact, Conversation, bool]:
    result = await db.execute(
        select(Contact).where(
            Contact.organization_id == whatsapp_account.organization_id,
            Contact.channel_id == whatsapp_account.channel_id,
            Contact.external_address == sender,
            Contact.deleted_at.is_(None),
        )
    )
    contact = result.scalar_one_or_none()
    if contact is None:
        contact = Contact(
            account_id=whatsapp_account.account_id,
            organization_id=whatsapp_account.organization_id,
            channel_id=whatsapp_account.channel_id,
            external_address=sender,
            display_name=display_name,
        )
        db.add(contact)
        await db.flush()
    elif display_name and not contact.display_name:
        contact.display_name = display_name

    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.contact_id == contact.id,
            Conversation.channel_id == whatsapp_account.channel_id,
            Conversation.deleted_at.is_(None),
            Conversation.status.in_([
                ConversationStatus.OPEN,
                ConversationStatus.PENDING,
            ]),
        )
    )
    conversation = conv_result.scalars().first()
    created_conversation = conversation is None
    if conversation is None:
        conversation = Conversation(
            account_id=whatsapp_account.account_id,
            organization_id=whatsapp_account.organization_id,
            channel_id=whatsapp_account.channel_id,
            contact_id=contact.id,
            status=ConversationStatus.OPEN,
        )
        db.add(conversation)
        await db.flush()
        assigned = await auto_assign_conversation(db, conversation=conversation)
        if assigned is not None:
            await create_notification(
                db,
                account_id=conversation.account_id,
                user_id=assigned.user_id,
                type="conversation_auto_assigned",
                title="تم تعيين محادثة جديدة تلقائيًا",
                body="وصلت محادثة جديدة وتم توزيعها عليك تلقائيًا.",
                data={"conversation_id": str(conversation.id)},
            )
    return contact, conversation, created_conversation

async def create_whatsapp_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: WhatsAppAccountCreateRequest,
) -> WhatsAppAccount:
    channel = await db.get(Channel, payload.channel_id)
    if channel is None or channel.account_id != account_id:
        raise ValueError("INVALID_CHANNEL")
    if channel.type != ChannelType.WHATSAPP:
        raise ValueError("CHANNEL_NOT_WHATSAPP")

    existing = await db.execute(
        select(WhatsAppAccount).where(
            WhatsAppAccount.phone_number_id == payload.phone_number_id
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ValueError("PHONE_NUMBER_ALREADY_CONNECTED")

    from app.services.whatsapp_health import parse_phone_health, sync_whatsapp_account_health_safe

    whatsapp_account = WhatsAppAccount(
        account_id=account_id,
        organization_id=channel.organization_id,
        channel_id=channel.id,
        waba_id=payload.waba_id,
        phone_number_id=payload.phone_number_id,
        display_phone_number=payload.display_phone_number,
        verified_name=payload.verified_name,
        access_token_encrypted=encrypt_secret(payload.access_token),
        status=WhatsAppAccountStatus.ACTIVE,
        connection_method=WhatsAppConnectionMethod.MANUAL,
    )
    client = MetaWhatsAppClient(
        access_token=payload.access_token,
        phone_number_id=payload.phone_number_id,
    )
    try:
        health = parse_phone_health(await client.get_phone_number_health())
    except MetaAPIError as exc:
        raise ValueError("INVALID_ACCESS_TOKEN") from exc
    finally:
        await client.aclose()

    if health.get("display_phone_number"):
        whatsapp_account.display_phone_number = health["display_phone_number"]
    if health.get("verified_name"):
        whatsapp_account.verified_name = health["verified_name"]
    whatsapp_account.quality_rating = health.get("quality_rating")
    whatsapp_account.messaging_limit_tier = health.get("messaging_limit_tier")
    whatsapp_account.messaging_limit = health.get("messaging_limit")
    channel.external_id = payload.phone_number_id
    channel.status = ChannelStatus.ACTIVE
    db.add(whatsapp_account)
    await db.commit()
    await db.refresh(whatsapp_account)
    await sync_whatsapp_account_health_safe(db, whatsapp_account=whatsapp_account)
    await db.refresh(whatsapp_account)
    try:
        from app.services.meta_setup import ensure_waba_webhook_subscription

        await ensure_waba_webhook_subscription(
            access_token=payload.access_token,
            waba_id=payload.waba_id,
        )
    except MetaAPIError:
        pass
    return whatsapp_account


async def update_whatsapp_access_token(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    access_token: str,
) -> WhatsAppAccount:
    from app.services.whatsapp_health import parse_phone_health

    whatsapp_account = await db.get(WhatsAppAccount, whatsapp_account_id)
    if whatsapp_account is None or whatsapp_account.account_id != account_id:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_FOUND")

    client = MetaWhatsAppClient(
        access_token=access_token,
        phone_number_id=whatsapp_account.phone_number_id,
    )
    try:
        health = parse_phone_health(await client.get_phone_number_health())
    except MetaAPIError as exc:
        raise ValueError("INVALID_ACCESS_TOKEN") from exc
    finally:
        await client.aclose()

    whatsapp_account.access_token_encrypted = encrypt_secret(access_token)
    whatsapp_account.status = WhatsAppAccountStatus.ACTIVE
    if health.get("display_phone_number"):
        whatsapp_account.display_phone_number = health["display_phone_number"]
    if health.get("verified_name"):
        whatsapp_account.verified_name = health["verified_name"]
    whatsapp_account.quality_rating = health.get("quality_rating")
    whatsapp_account.messaging_limit_tier = health.get("messaging_limit_tier")
    whatsapp_account.messaging_limit = health.get("messaging_limit")
    whatsapp_account.health_synced_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(whatsapp_account)
    return whatsapp_account


def _account_to_response(
    item: WhatsAppAccount,
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
        "waba_id": item.waba_id,
        "phone_number_id": item.phone_number_id,
        "display_phone_number": item.display_phone_number,
        "verified_name": item.verified_name,
        "status": item.status,
        "connection_method": item.connection_method or WhatsAppConnectionMethod.MANUAL,
        "quality_rating": item.quality_rating,
        "messaging_limit_tier": item.messaging_limit_tier,
        "messaging_limit": item.messaging_limit,
        "health_synced_at": item.health_synced_at,
        "meta_catalog_id": item.meta_catalog_id,
        "commerce_enabled": bool(item.commerce_enabled),
        "catalog_synced_at": item.catalog_synced_at,
    }


async def create_whatsapp_account_from_embedded(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload,
) -> WhatsAppAccount:
    from app.services.meta_client import MetaWhatsAppClient
    from app.services.whatsapp_health import parse_phone_health, sync_whatsapp_account_health_safe

    channel = await db.get(Channel, payload.channel_id)
    if channel is None or channel.account_id != account_id:
        raise ValueError("INVALID_CHANNEL")
    if channel.type != ChannelType.WHATSAPP:
        raise ValueError("CHANNEL_NOT_WHATSAPP")

    existing = await db.execute(
        select(WhatsAppAccount).where(
            WhatsAppAccount.phone_number_id == payload.phone_number_id
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ValueError("PHONE_NUMBER_ALREADY_CONNECTED")

    access_token = payload.access_token
    if payload.code:
        access_token = await MetaWhatsAppClient.exchange_oauth_code(code=payload.code)
    if not access_token:
        raise ValueError("MISSING_ACCESS_TOKEN")

    client = MetaWhatsAppClient(
        access_token=access_token,
        phone_number_id=payload.phone_number_id,
    )
    try:
        health = parse_phone_health(await client.get_phone_number_health())
    finally:
        await client.aclose()

    display_phone = (
        payload.display_phone_number
        or health.get("display_phone_number")
        or payload.phone_number_id
    )
    whatsapp_account = WhatsAppAccount(
        account_id=account_id,
        organization_id=channel.organization_id,
        channel_id=channel.id,
        waba_id=payload.waba_id,
        phone_number_id=payload.phone_number_id,
        display_phone_number=display_phone,
        verified_name=payload.verified_name or health.get("verified_name"),
        access_token_encrypted=encrypt_secret(access_token),
        status=WhatsAppAccountStatus.ACTIVE,
        connection_method=WhatsAppConnectionMethod.EMBEDDED,
        quality_rating=health.get("quality_rating"),
        messaging_limit_tier=health.get("messaging_limit_tier"),
        messaging_limit=health.get("messaging_limit"),
    )
    channel.external_id = payload.phone_number_id
    channel.status = ChannelStatus.ACTIVE
    db.add(whatsapp_account)
    await db.commit()
    await db.refresh(whatsapp_account)
    await sync_whatsapp_account_health_safe(db, whatsapp_account=whatsapp_account)
    await db.refresh(whatsapp_account)
    try:
        from app.services.meta_setup import ensure_waba_webhook_subscription

        await ensure_waba_webhook_subscription(
            access_token=access_token,
            waba_id=payload.waba_id,
        )
    except MetaAPIError:
        pass
    return whatsapp_account


async def list_whatsapp_accounts(
    db: AsyncSession, account_id: UUID
) -> list[tuple[WhatsAppAccount, str | None, str | None]]:
    from app.models.channel import Channel
    from app.models.organization import Organization

    result = await db.execute(
        select(WhatsAppAccount, Channel.name, Organization.name)
        .join(Channel, WhatsAppAccount.channel_id == Channel.id)
        .join(Organization, WhatsAppAccount.organization_id == Organization.id)
        .where(WhatsAppAccount.account_id == account_id)
        .order_by(WhatsAppAccount.created_at.asc())
    )
    return list(result.all())


async def send_text_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    payload: SendTextMessageRequest,
    record_mac: bool = False,
    mac_trigger_source: "MacTriggerSource | None" = None,
) -> Message:
    whatsapp_account = await db.get(WhatsAppAccount, whatsapp_account_id)
    if (
        whatsapp_account is None
        or whatsapp_account.account_id != account_id
        or whatsapp_account.status != WhatsAppAccountStatus.ACTIVE
    ):
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db,
        whatsapp_account=whatsapp_account,
        sender=payload.to,
        display_name=None,
    )

    message = Message(
        account_id=account_id,
        organization_id=whatsapp_account.organization_id,
        channel_id=whatsapp_account.channel_id,
        contact_id=contact.id,
        conversation_id=conversation.id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.TEXT,
        from_address=whatsapp_account.display_phone_number,
        to_address=payload.to,
        text_body=payload.text,
        status=MessageStatus.QUEUED,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(whatsapp_account.access_token_encrypted),
        phone_number_id=whatsapp_account.phone_number_id,
    )
    try:
        response = await client.send_text(
            to=payload.to,
            text=payload.text,
            preview_url=payload.preview_url,
        )
    except MetaAPIError as exc:
        message.status = MessageStatus.FAILED
        message.provider_payload = exc.response_data
        await db.commit()
        raise

    messages = response.get("messages", [])
    message.external_message_id = messages[0].get("id") if messages else None
    conversation.last_message_at = datetime.now(UTC)
    if conversation.first_response_at is None:
        conversation.first_response_at = datetime.now(UTC)
    message.provider_payload = response
    message.status = MessageStatus.SENT
    await db.commit()
    await db.refresh(message)
    if record_mac:
        await _record_mac_for_contact(
            db,
            account_id=account_id,
            channel_id=whatsapp_account.channel_id,
            contact_id=contact.id,
            inbound=False,
            trigger_source=mac_trigger_source,
        )
    return message


def _extract_event_type(value: dict) -> str:
    if value.get("messages"):
        return "message"
    if value.get("statuses"):
        return "message_status"
    if value.get("errors"):
        return "error"
    return "unknown"


async def store_and_process_webhook(db: AsyncSession, payload: dict) -> dict[str, int | list[str]]:
    processed_count = 0
    automation_run_ids: list[str] = []
    capi_leads: list[tuple[str, str, str | None]] = []
    entries = payload.get("entry", [])
    for entry in entries:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            metadata = value.get("metadata", {})
            phone_number_id = metadata.get("phone_number_id")
            event_type = _extract_event_type(value)

            whatsapp_account = None
            if phone_number_id:
                result = await db.execute(
                    select(WhatsAppAccount).where(
                        WhatsAppAccount.phone_number_id == phone_number_id
                    )
                )
                whatsapp_account = result.scalar_one_or_none()

            event = WebhookEvent(
                provider="meta_whatsapp",
                account_id=whatsapp_account.account_id if whatsapp_account else None,
                channel_id=whatsapp_account.channel_id if whatsapp_account else None,
                event_type=event_type,
                payload={"entry": entry, "change": change},
                status=(
                    WebhookEventStatus.RECEIVED
                    if whatsapp_account
                    else WebhookEventStatus.IGNORED
                ),
            )
            db.add(event)
            await db.flush()

            if whatsapp_account and event_type == "message":
                from app.services.inbound_whatsapp import (
                    persist_inbound_message,
                    process_inbound_side_effects,
                    publish_inbound_message_event,
                )

                for item in value.get("messages", []):
                    try:
                        ctx = await persist_inbound_message(
                            db,
                            whatsapp_account=whatsapp_account,
                            item=item,
                            value=value,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to persist inbound WhatsApp message external_id=%s from=%s",
                            item.get("id"),
                            item.get("from"),
                        )
                        continue

                    if ctx is None:
                        continue

                    if ctx.referral_fields and whatsapp_account:
                        capi_leads.append(
                            (
                                str(whatsapp_account.account_id),
                                ctx.sender,
                                ctx.referral_fields.get("utm_campaign"),
                            )
                        )

                    await db.commit()

                    processed_count += 1

                    try:
                        await publish_inbound_message_event(
                            whatsapp_account.account_id,
                            conversation_id=ctx.conversation.id,
                            contact_id=ctx.contact.id,
                            external_id=ctx.external_id,
                            message_id=ctx.message.id,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to publish realtime event for message_id=%s",
                            ctx.message.id,
                        )

                    try:
                        run_ids = await process_inbound_side_effects(
                            db,
                            whatsapp_account=whatsapp_account,
                            ctx=ctx,
                        )
                        automation_run_ids.extend(run_ids)
                        await db.commit()
                    except Exception:
                        logger.exception(
                            "Failed inbound side effects for message_id=%s",
                            ctx.message.id,
                        )
                        await db.rollback()

                event.status = WebhookEventStatus.PROCESSED
                event.processed_at = datetime.now(UTC)

            elif whatsapp_account and event_type == "message_status":
                for status_item in value.get("statuses", []):
                    external_id = status_item.get("id")
                    if not external_id:
                        continue
                    status_value = status_item.get("status")
                    result = await db.execute(
                        select(Message).where(Message.external_message_id == external_id)
                    )
                    message = result.scalar_one_or_none()
                    if message:
                        try:
                            message.status = MessageStatus(status_value)
                        except ValueError:
                            pass
                        message.provider_payload = status_item
                        conversation = await db.get(Conversation, message.conversation_id)
                        if conversation is not None:
                            conversation.last_message_at = datetime.now(UTC)

                    recipient_result = await db.execute(
                        select(CampaignRecipient).where(
                            CampaignRecipient.external_message_id == external_id
                        )
                    )
                    recipient = recipient_result.scalar_one_or_none()
                    if recipient is not None and status_value:
                        try:
                            recipient.status = CampaignRecipientStatus(status_value)
                        except ValueError:
                            if status_value == "failed":
                                recipient.status = CampaignRecipientStatus.FAILED
                        if status_value == "failed":
                            errors = status_item.get("errors") or []
                            if isinstance(errors, list) and errors:
                                first = errors[0] if isinstance(errors[0], dict) else {}
                                detail = first.get("title") or first.get("message") or first.get("code")
                                if detail:
                                    recipient.error_message = str(detail)[:2000]
                    if message is not None or recipient is not None:
                        processed_count += 1

                event.status = WebhookEventStatus.PROCESSED
                event.processed_at = datetime.now(UTC)

            if whatsapp_account:
                await add_outbox_event(db, account_id=whatsapp_account.account_id, event_type=f"whatsapp.{event_type}", aggregate_type="webhook_event", aggregate_id=str(event.id), payload={"webhook_event_id": str(event.id), "processed_count": processed_count})

    await db.commit()
    if capi_leads:
        from app.workers.growth_tasks import send_meta_capi_lead

        for account_id, phone, utm_campaign in capi_leads:
            send_meta_capi_lead.delay(account_id, phone, utm_campaign)
    for entry in entries:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            metadata = value.get("metadata", {})
            phone_number_id = metadata.get("phone_number_id")
            if phone_number_id:
                result = await db.execute(
                    select(WhatsAppAccount).where(
                        WhatsAppAccount.phone_number_id == phone_number_id
                    )
                )
                wa_account = result.scalar_one_or_none()
                if wa_account:
                    await publish_event(
                        wa_account.account_id,
                        {"type": "whatsapp.updated", "count": processed_count},
                    )
    return {"processed_count": processed_count, "automation_run_ids": automation_run_ids}


async def send_media_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    media_type: MessageType,
    payload: SendMediaMessageRequest,
    record_mac: bool = False,
) -> Message:
    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != account_id or wa.status != WhatsAppAccountStatus.ACTIVE:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db, whatsapp_account=wa, sender=payload.to, display_name=None
    )
    message = Message(
        account_id=account_id,
        organization_id=wa.organization_id,
        channel_id=wa.channel_id,
        contact_id=contact.id,
        conversation_id=conversation.id,
        direction=MessageDirection.OUTBOUND,
        type=media_type,
        from_address=wa.display_phone_number,
        to_address=payload.to,
        text_body=payload.caption,
        provider_payload={"media_url": str(payload.media_url), "filename": payload.filename},
        status=MessageStatus.QUEUED,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    try:
        response = await client.send_media(
            to=payload.to,
            media_type=media_type.value,
            media_url=str(payload.media_url),
            caption=payload.caption,
            filename=payload.filename,
        )
    except MetaAPIError as exc:
        message.status = MessageStatus.FAILED
        message.provider_payload = exc.response_data
        await db.commit()
        raise

    items = response.get("messages", [])
    message.external_message_id = items[0].get("id") if items else None
    message.provider_payload = response
    message.status = MessageStatus.SENT
    conversation.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    if record_mac:
        await _record_mac_for_contact(
            db,
            account_id=account_id,
            channel_id=wa.channel_id,
            contact_id=contact.id,
            inbound=False,
        )
    return message


async def send_template_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    payload: SendTemplateMessageRequest,
    record_mac: bool = False,
    display_components: list | None = None,
    display_body_text: str | None = None,
) -> Message:
    from app.services.template_display import render_template_body_text

    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != account_id or wa.status != WhatsAppAccountStatus.ACTIVE:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db, whatsapp_account=wa, sender=payload.to, display_name=None
    )
    stored_components = display_components if display_components else []
    text_body = render_template_body_text(stored_components, fallback=display_body_text)
    template_payload = {
        "template_name": payload.template_name,
        "language_code": payload.language_code,
        "send_components": payload.components,
        "components": stored_components,
    }
    message = Message(
        account_id=account_id,
        organization_id=wa.organization_id,
        channel_id=wa.channel_id,
        contact_id=contact.id,
        conversation_id=conversation.id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.TEMPLATE,
        from_address=wa.display_phone_number,
        to_address=payload.to,
        text_body=text_body,
        provider_payload=template_payload,
        status=MessageStatus.QUEUED,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    try:
        response = await client.send_template(
            to=payload.to,
            template_name=payload.template_name,
            language_code=payload.language_code,
            components=payload.components,
        )
    except MetaAPIError as exc:
        message.status = MessageStatus.FAILED
        if isinstance(message.provider_payload, dict):
            message.provider_payload = {
                **message.provider_payload,
                "meta_error": exc.response_data,
            }
        else:
            message.provider_payload = {"meta_error": exc.response_data}
        await db.commit()
        raise

    items = response.get("messages", [])
    message.external_message_id = items[0].get("id") if items else None
    if isinstance(message.provider_payload, dict):
        message.provider_payload = {
            **message.provider_payload,
            "meta_response": response,
        }
    else:
        message.provider_payload = template_payload | {"meta_response": response}
    message.status = MessageStatus.SENT
    conversation.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    if record_mac:
        await _record_mac_for_contact(
            db,
            account_id=account_id,
            channel_id=wa.channel_id,
            contact_id=contact.id,
            inbound=False,
        )
    return message


async def send_product_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    to: str,
    catalog_id: str,
    product_retailer_id: str,
    body: str,
    footer: str | None = None,
    product_id: UUID | None = None,
    record_mac: bool = False,
) -> Message:
    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != account_id or wa.status != WhatsAppAccountStatus.ACTIVE:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
    if not wa.commerce_enabled or not wa.meta_catalog_id:
        raise ValueError("COMMERCE_NOT_CONFIGURED")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db, whatsapp_account=wa, sender=to, display_name=None
    )
    message = Message(
        account_id=account_id,
        organization_id=wa.organization_id,
        channel_id=wa.channel_id,
        contact_id=contact.id,
        conversation_id=conversation.id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.INTERACTIVE,
        from_address=wa.display_phone_number,
        to_address=to,
        text_body=body,
        provider_payload={
            "interactive_type": "product",
            "catalog_id": catalog_id,
            "product_retailer_id": product_retailer_id,
            "product_id": str(product_id) if product_id else None,
        },
        status=MessageStatus.QUEUED,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    try:
        response = await client.send_single_product(
            to=to,
            catalog_id=catalog_id,
            product_retailer_id=product_retailer_id,
            body=body,
            footer=footer,
        )
    except MetaAPIError as exc:
        message.status = MessageStatus.FAILED
        message.provider_payload = exc.response_data
        await db.commit()
        raise

    items = response.get("messages", [])
    message.external_message_id = items[0].get("id") if items else None
    message.provider_payload = response
    message.status = MessageStatus.SENT
    conversation.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)

    if product_id:
        from app.models.catalog_product import CatalogProduct
        from app.services.catalog_commerce import increment_product_usage

        product = await db.get(CatalogProduct, product_id)
        if product is not None and product.account_id == account_id:
            await increment_product_usage(db, product=product)

    if record_mac:
        await _record_mac_for_contact(
            db,
            account_id=account_id,
            channel_id=wa.channel_id,
            contact_id=contact.id,
            inbound=False,
        )
    return message


async def send_product_list_message(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    to: str,
    catalog_id: str,
    sections: list[dict],
    body: str,
    header: str | None = None,
    footer: str | None = None,
    record_mac: bool = False,
) -> Message:
    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != account_id or wa.status != WhatsAppAccountStatus.ACTIVE:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
    if not wa.commerce_enabled or not wa.meta_catalog_id:
        raise ValueError("COMMERCE_NOT_CONFIGURED")

    contact, conversation, _ = await _get_or_create_contact_and_conversation(
        db, whatsapp_account=wa, sender=to, display_name=None
    )
    message = Message(
        account_id=account_id,
        organization_id=wa.organization_id,
        channel_id=wa.channel_id,
        contact_id=contact.id,
        conversation_id=conversation.id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.INTERACTIVE,
        from_address=wa.display_phone_number,
        to_address=to,
        text_body=body,
        provider_payload={
            "interactive_type": "product_list",
            "catalog_id": catalog_id,
            "sections": sections,
        },
        status=MessageStatus.QUEUED,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    try:
        response = await client.send_product_list(
            to=to,
            catalog_id=catalog_id,
            sections=sections,
            body=body,
            header=header,
            footer=footer,
        )
    except MetaAPIError as exc:
        message.status = MessageStatus.FAILED
        message.provider_payload = exc.response_data
        await db.commit()
        raise

    items = response.get("messages", [])
    message.external_message_id = items[0].get("id") if items else None
    message.provider_payload = response
    message.status = MessageStatus.SENT
    conversation.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    if record_mac:
        await _record_mac_for_contact(
            db,
            account_id=account_id,
            channel_id=wa.channel_id,
            contact_id=contact.id,
            inbound=False,
        )
    return message
