"""Persist inbound WhatsApp webhook messages reliably, then run side effects."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.membership import Membership
from app.models.message import Message, MessageDirection, MessageStatus, MessageType
from app.models.whatsapp_account import WhatsAppAccount
from app.models.automation import AutomationTriggerType
from app.realtime.event_bus import publish_event
from app.schemas.whatsapp import SendTextMessageRequest
from app.services.automation_triggers import queue_automation_runs
from app.services.notifications import create_notification
from app.services.whatsapp_window import compute_service_window

logger = logging.getLogger(__name__)


@dataclass
class InboundMessageContext:
    contact: Contact
    conversation: Conversation
    created_conversation: bool
    message: Message
    text_body: str | None
    message_type: MessageType
    interactive_reply: dict[str, Any] | None
    sender: str
    referral_fields: dict[str, Any] | None
    external_id: str | None


async def find_duplicate_inbound(db: AsyncSession, external_id: str | None) -> bool:
    if not external_id:
        return False
    result = await db.execute(select(Message.id).where(Message.external_message_id == external_id))
    return result.scalar_one_or_none() is not None


async def _get_or_create_contact_and_conversation(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
    sender: str,
    display_name: str | None,
) -> tuple[Contact, Conversation, bool]:
    from app.services.assignments import auto_assign_conversation

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
            Conversation.status.in_([ConversationStatus.OPEN, ConversationStatus.PENDING]),
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


async def persist_inbound_message(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
    item: dict[str, Any],
    value: dict[str, Any],
) -> InboundMessageContext | None:
    """Save the inbound message. Returns None when Meta resent a duplicate."""
    external_id = item.get("id")
    if await find_duplicate_inbound(db, external_id):
        return None

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            async with db.begin_nested():
                sender = item.get("from", "")
                contact_name = None
                contacts = value.get("contacts", [])
                if contacts:
                    contact_name = contacts[0].get("profile", {}).get("name")

                contact, conversation, created_conversation = await _get_or_create_contact_and_conversation(
                    db,
                    whatsapp_account=whatsapp_account,
                    sender=sender,
                    display_name=contact_name,
                )

                from app.services.ctwa_attribution import apply_referral_to_contact, extract_referral_fields
                from app.services.inbound_interactive import extract_interactive_reply

                referral_fields = extract_referral_fields(item)
                apply_referral_to_contact(contact, referral_fields)
                interactive_reply = extract_interactive_reply(item)
                message_type_value = item.get("type", "unknown")
                try:
                    message_type = MessageType(message_type_value)
                except ValueError:
                    message_type = MessageType.IMAGE if message_type_value == "sticker" else MessageType.UNKNOWN

                from app.services.whatsapp_media import (
                    MEDIA_MESSAGE_TYPES,
                    extract_inbound_text_and_caption,
                    store_inbound_whatsapp_media,
                )

                text_body = extract_inbound_text_and_caption(item, message_type)
                if interactive_reply and interactive_reply.get("text") and not text_body:
                    text_body = str(interactive_reply["text"])
                provider_payload = dict(item)
                if interactive_reply:
                    provider_payload["interactive_reply"] = interactive_reply
                if message_type in MEDIA_MESSAGE_TYPES:
                    media_fields = await store_inbound_whatsapp_media(
                        whatsapp_account=whatsapp_account,
                        item=item,
                        message_type=message_type,
                        access_token=decrypt_secret(whatsapp_account.access_token_encrypted),
                    )
                    provider_payload.update(media_fields)
                    if not text_body and media_fields.get("caption"):
                        text_body = media_fields["caption"]

                message = Message(
                    account_id=whatsapp_account.account_id,
                    organization_id=whatsapp_account.organization_id,
                    channel_id=whatsapp_account.channel_id,
                    contact_id=contact.id,
                    conversation_id=conversation.id,
                    external_message_id=external_id,
                    direction=MessageDirection.INBOUND,
                    type=message_type,
                    from_address=sender,
                    to_address=whatsapp_account.display_phone_number,
                    text_body=text_body,
                    provider_payload=provider_payload,
                    status=MessageStatus.RECEIVED,
                )
                db.add(message)
                await db.flush()
                conversation.last_message_at = datetime.now(UTC)

                return InboundMessageContext(
                    contact=contact,
                    conversation=conversation,
                    created_conversation=created_conversation,
                    message=message,
                    text_body=text_body,
                    message_type=message_type,
                    interactive_reply=interactive_reply,
                    sender=sender,
                    referral_fields=referral_fields,
                    external_id=external_id,
                )
        except IntegrityError as exc:
            last_error = exc
            if await find_duplicate_inbound(db, external_id):
                return None
            if attempt == 0:
                logger.warning(
                    "Retrying inbound WhatsApp message after integrity conflict external_id=%s",
                    external_id,
                )
                continue
            raise
        except Exception:
            raise

    if last_error:
        raise last_error
    return None


async def process_inbound_side_effects(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
    ctx: InboundMessageContext,
) -> list[str]:
    """Run automations, AI, notifications, etc. Failures must not drop the saved message."""
    automation_run_ids: list[str] = []
    contact = ctx.contact
    conversation = ctx.conversation
    text_body = ctx.text_body
    sender = ctx.sender
    interactive_reply = ctx.interactive_reply
    message_type = ctx.message_type
    created_conversation = ctx.created_conversation

    try:
        from app.services.feature_flags import get_feature_flags
        from app.services.sla_monitor import set_sla_deadline_on_inbound

        power_flags = await get_feature_flags(db, account_id=whatsapp_account.account_id)
        if power_flags.get("sla_monitoring", True):
            await set_sla_deadline_on_inbound(db, conversation=conversation)
    except Exception:
        logger.exception("SLA update failed for conversation_id=%s", conversation.id)

    try:
        from app.services.link_tracking import apply_inbound_attribution

        await apply_inbound_attribution(db, contact=contact, text_body=text_body)
    except Exception:
        logger.exception("Inbound attribution failed for contact_id=%s", contact.id)

    try:
        from app.services.contact_management import apply_auto_tags_from_inbound

        await apply_auto_tags_from_inbound(
            db,
            account_id=whatsapp_account.account_id,
            contact_id=contact.id,
            text_body=text_body,
        )
    except Exception:
        logger.exception("Auto tags failed for contact_id=%s", contact.id)

    if text_body:
        try:
            from app.services.crm import maybe_auto_create_deal_from_inbound

            auto_deal = await maybe_auto_create_deal_from_inbound(
                db,
                account_id=whatsapp_account.account_id,
                contact_id=contact.id,
                organization_id=whatsapp_account.organization_id,
                text_body=text_body,
            )
            if auto_deal:
                await publish_event(
                    whatsapp_account.account_id,
                    {
                        "type": "crm.deal_created",
                        "deal_id": str(auto_deal.id),
                        "contact_id": str(contact.id),
                        "conversation_id": str(conversation.id),
                        "title": auto_deal.title,
                    },
                )
        except Exception:
            logger.exception("Auto deal failed for contact_id=%s", contact.id)

    try:
        from app.services.link_tracking import parse_csat_score
        from app.services.csat import submit_conversation_rating

        csat_score = parse_csat_score(text_body)
        if csat_score is not None:
            await submit_conversation_rating(
                db,
                account_id=whatsapp_account.account_id,
                conversation_id=conversation.id,
                score=csat_score,
                comment=None,
                source="customer",
            )
    except ValueError:
        pass
    except Exception:
        logger.exception("CSAT handling failed for conversation_id=%s", conversation.id)

    try:
        from app.services.webhook_dispatch import dispatch_account_webhook

        await dispatch_account_webhook(
            db,
            account_id=whatsapp_account.account_id,
            event_type="message.received",
            payload={
                "conversation_id": str(conversation.id),
                "contact_id": str(contact.id),
                "from": sender,
                "text": text_body,
                "created_at": datetime.now(UTC).isoformat(),
            },
        )
    except Exception:
        logger.exception("Account webhook dispatch failed for conversation_id=%s", conversation.id)

    trigger_payload = {
        "organization_id": str(whatsapp_account.organization_id),
        "channel_id": str(whatsapp_account.channel_id),
        "conversation_id": str(conversation.id),
        "contact_id": str(contact.id),
        "whatsapp_account_id": str(whatsapp_account.id),
        "from": sender,
        "text": text_body,
        "message_type": message_type.value,
    }
    if interactive_reply:
        trigger_payload.update(
            {
                "button_id": interactive_reply.get("button_id"),
                "button_title": interactive_reply.get("button_title"),
                "list_id": interactive_reply.get("list_id"),
                "interactive_type": interactive_reply.get("interactive_type"),
            }
        )

    try:
        automation_run_ids.extend(
            str(run_id)
            for run_id in await queue_automation_runs(
                db,
                account_id=whatsapp_account.account_id,
                trigger_type=AutomationTriggerType.MESSAGE_RECEIVED,
                trigger_payload=trigger_payload,
            )
        )
        if interactive_reply and interactive_reply.get("button_id"):
            automation_run_ids.extend(
                str(run_id)
                for run_id in await queue_automation_runs(
                    db,
                    account_id=whatsapp_account.account_id,
                    trigger_type=AutomationTriggerType.BUTTON_CLICKED,
                    trigger_payload=trigger_payload,
                )
            )
        if created_conversation:
            automation_run_ids.extend(
                str(run_id)
                for run_id in await queue_automation_runs(
                    db,
                    account_id=whatsapp_account.account_id,
                    trigger_type=AutomationTriggerType.CONVERSATION_CREATED,
                    trigger_payload=trigger_payload,
                )
            )
    except Exception:
        logger.exception("Automation queue failed for conversation_id=%s", conversation.id)

    try:
        assignee_user_id = None
        if conversation.assigned_membership_id:
            membership = await db.get(Membership, conversation.assigned_membership_id)
            assignee_user_id = membership.user_id if membership else None
        await create_notification(
            db,
            account_id=whatsapp_account.account_id,
            user_id=assignee_user_id,
            type="message_received",
            title="رسالة WhatsApp جديدة",
            body=text_body or f"رسالة جديدة من {sender}",
            data={"conversation_id": str(conversation.id)},
        )
    except Exception:
        logger.exception("Notification failed for conversation_id=%s", conversation.id)

    if text_body:
        try:
            from app.services.feature_flags import get_feature_flags
            from app.services.knowledge_base import get_agent_settings, suggest_smart_reply

            power_flags = await get_feature_flags(db, account_id=whatsapp_account.account_id)
            agent_settings = await get_agent_settings(db, whatsapp_account.account_id)
            ai_result = await suggest_smart_reply(
                db,
                account_id=whatsapp_account.account_id,
                query=text_body,
                contact_name=contact.display_name or "",
                mode=agent_settings.default_mode,
                use_llm=agent_settings.llm_enabled,
            )
            ai_event_type = "ai.kb_suggestion"
            if ai_result.get("source") == "catalog":
                ai_event_type = "ai.catalog_suggestion"
            elif ai_result.get("source") == "combined":
                ai_event_type = "ai.combined_suggestion"
            elif agent_settings.auto_kb_on_inbound and ai_result.get("matched_articles"):
                ai_event_type = "ai.kb_suggestion"
            await publish_event(
                whatsapp_account.account_id,
                {
                    "type": ai_event_type,
                    "conversation_id": str(conversation.id),
                    "suggestion": ai_result.get("suggestion"),
                    "matched_products": ai_result.get("matched_products", []),
                    "matched_articles": ai_result.get("matched_articles", []),
                    "confidence": ai_result.get("confidence"),
                    "source": ai_result.get("source"),
                },
            )

            from app.services.business_hours import is_within_business_hours
            from app.services.whatsapp import send_text_message

            if (
                power_flags.get("ai_agent_auto_reply", True)
                and agent_settings.auto_reply_outside_hours
                and not is_within_business_hours(agent_settings.business_hours_json)
                and not conversation.first_response_at
            ):
                outside_text = (agent_settings.outside_hours_message or "").strip()
                if not outside_text:
                    outside_text = str(ai_result.get("suggestion") or "").strip()
                if not outside_text:
                    outside_text = "شكراً لتواصلك. نحن خارج ساعات العمل حالياً وسنرد عليك في أقرب وقت."
                window = compute_service_window(conversation.last_message_at)
                if window.get("service_window_open"):
                    try:
                        await send_text_message(
                            db,
                            account_id=whatsapp_account.account_id,
                            whatsapp_account_id=whatsapp_account.id,
                            payload=SendTextMessageRequest(to=sender, text=outside_text),
                        )
                        conversation.first_response_at = datetime.now(UTC)
                    except ValueError:
                        pass
        except Exception:
            logger.exception("Inbound AI side effects failed for conversation_id=%s", conversation.id)

    return automation_run_ids


async def publish_inbound_message_event(
    account_id: UUID,
    *,
    conversation_id: UUID,
    contact_id: UUID,
    external_id: str | None,
    message_id: UUID,
) -> None:
    await publish_event(
        account_id,
        {
            "type": "message.received",
            "conversation_id": str(conversation_id),
            "contact_id": str(contact_id),
            "message_id": str(message_id),
            "external_message_id": external_id,
        },
    )
