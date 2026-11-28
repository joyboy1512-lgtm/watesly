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
    order_data: dict[str, Any] | None = None


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
    from app.services.contacts import find_contact_on_channel_by_phone
    from app.services.phone_normalize import normalize_whatsapp_phone

    sender = normalize_whatsapp_phone(sender)
    if not sender:
        raise ValueError("INVALID_SENDER")

    contact = await find_contact_on_channel_by_phone(
        db,
        organization_id=whatsapp_account.organization_id,
        channel_id=whatsapp_account.channel_id,
        external_address=sender,
    )
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
    else:
        # Meta sends WhatsApp profile.name on inbound; keep contact name in sync.
        if display_name and display_name != (contact.display_name or ""):
            contact.display_name = display_name
        if contact.external_address != sender:
            contact.external_address = sender

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
                from app.services.inbound_commerce import (
                    format_order_text,
                    inbound_message_type_for_item,
                    parse_whatsapp_order,
                )

                message_type = inbound_message_type_for_item(message_type_value)
                order_data = parse_whatsapp_order(item) if message_type == MessageType.ORDER else None

                from app.services.whatsapp_media import (
                    MEDIA_MESSAGE_TYPES,
                    extract_inbound_text_and_caption,
                    store_inbound_whatsapp_media,
                )

                text_body = extract_inbound_text_and_caption(item, message_type)
                if order_data:
                    text_body = format_order_text(order_data)
                if interactive_reply and interactive_reply.get("text") and not text_body:
                    text_body = str(interactive_reply["text"])
                provider_payload = dict(item)
                if interactive_reply:
                    provider_payload["interactive_reply"] = interactive_reply
                if order_data:
                    provider_payload["order_parsed"] = order_data
                from app.services.inbound_commerce import extract_referred_product

                referred_product = extract_referred_product(item)
                if referred_product:
                    provider_payload["referred_product"] = referred_product
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

                from app.models.monthly_active_contact import MacTriggerSource
                from app.services.mac_usage import record_mac

                await record_mac(
                    db,
                    account_id=whatsapp_account.account_id,
                    channel_id=whatsapp_account.channel_id,
                    contact_id=contact.id,
                    trigger_source=MacTriggerSource.INBOUND,
                    organization_id=contact.organization_id,
                    source_event_id=external_id,
                    message_id=message.id,
                )

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
                    order_data=order_data,
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
        from app.services.contact_reachability import record_inbound_activity

        await record_inbound_activity(db, contact=contact)
    except Exception:
        logger.exception("Reachability update failed for contact_id=%s", contact.id)

    try:
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

    try:
        from app.services.marketing_compliance import maybe_handle_marketing_opt_out

        await maybe_handle_marketing_opt_out(
            db,
            whatsapp_account=whatsapp_account,
            contact=contact,
            conversation=conversation,
            text_body=text_body,
            interactive_reply=interactive_reply,
        )
    except Exception:
        logger.exception("Marketing opt-out handling failed for contact_id=%s", contact.id)

    try:
        from app.services.marketing_compliance import maybe_handle_marketing_interested

        await maybe_handle_marketing_interested(
            db,
            whatsapp_account=whatsapp_account,
            contact=contact,
            conversation=conversation,
            text_body=text_body,
            interactive_reply=interactive_reply,
        )
    except Exception:
        logger.exception("Marketing interested handling failed for contact_id=%s", contact.id)

    if ctx.order_data:
        try:
            from app.services.inbound_commerce import (
                create_deal_from_whatsapp_order,
                format_order_text,
                resolve_order_product_names,
            )

            product_names = await resolve_order_product_names(
                db,
                account_id=whatsapp_account.account_id,
                product_items=ctx.order_data.get("product_items") or [],
            )
            ctx.message.text_body = format_order_text(ctx.order_data, product_names=product_names)
            deal = await create_deal_from_whatsapp_order(
                db,
                account_id=whatsapp_account.account_id,
                contact_id=contact.id,
                organization_id=whatsapp_account.organization_id,
                order_data=ctx.order_data,
                conversation_id=conversation.id,
            )
            from app.services.catalog_orders import create_catalog_order

            catalog_order = await create_catalog_order(
                db,
                account_id=whatsapp_account.account_id,
                organization_id=whatsapp_account.organization_id,
                channel_id=whatsapp_account.channel_id,
                contact_id=contact.id,
                conversation_id=conversation.id,
                message_id=ctx.message.id,
                deal_id=deal.id,
                order_data=ctx.order_data,
                product_names=product_names,
            )
            from app.services.catalog_orders import notify_catalog_order_received

            await notify_catalog_order_received(
                db,
                account_id=whatsapp_account.account_id,
                order=catalog_order,
                contact_name=contact.display_name,
            )
            await publish_event(
                whatsapp_account.account_id,
                {
                    "type": "commerce.order_received",
                    "deal_id": str(deal.id),
                    "catalog_order_id": str(catalog_order.id),
                    "order_number": catalog_order.order_number,
                    "contact_id": str(contact.id),
                    "conversation_id": str(conversation.id),
                    "title": deal.title,
                },
            )
        except Exception:
            logger.exception("WhatsApp order deal creation failed for contact_id=%s", contact.id)

    if text_body and not ctx.order_data:
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
            data={
                "conversation_id": str(conversation.id),
                "organization_id": str(conversation.organization_id),
            },
        )
    except Exception:
        logger.exception("Notification failed for conversation_id=%s", conversation.id)

    if text_body:
        try:
            from app.services.ai_ops import get_effective_agent_settings, log_ai_activity
            from app.services.feature_flags import get_feature_flags
            from app.services.knowledge_base import suggest_smart_reply

            power_flags = await get_feature_flags(db, account_id=whatsapp_account.account_id)
            agent_settings = await get_effective_agent_settings(
                db,
                account_id=whatsapp_account.account_id,
                channel_id=whatsapp_account.channel_id,
            )
            agent_live = bool(agent_settings.get("agent_enabled", True)) and bool(
                agent_settings.get("account_agent_enabled", True)
            )

            from app.models.monthly_active_contact import MacTriggerSource
            from app.services.business_hours import is_within_business_hours
            from app.services.whatsapp import send_text_message

            within_hours = is_within_business_hours(agent_settings.get("business_hours_json"))
            auto_reply_inbound = bool(agent_settings.get("auto_reply_on_inbound", False))
            auto_kb_on_inbound = bool(agent_settings.get("auto_kb_on_inbound", True))
            auto_reply_outside_hours = bool(agent_settings.get("auto_reply_outside_hours", False))
            default_mode = str(agent_settings.get("default_mode") or "kb_first")
            need_ai = agent_live and (
                auto_kb_on_inbound
                or auto_reply_inbound
                or (auto_reply_outside_hours and not within_hours)
            )
            ai_result: dict = {}
            escalated_now = False
            if need_ai:
                from app.services.catalog_dialogue import load_catalog_dialogue, save_catalog_dialogue

                dialogue_state = await load_catalog_dialogue(
                    account_id=whatsapp_account.account_id,
                    conversation_id=conversation.id,
                )
                already_escalated = bool((dialogue_state or {}).get("escalated"))
                staff_owns = conversation.assigned_membership_id is not None
                if already_escalated:
                    auto_reply_inbound = False
                    await log_ai_activity(
                        db,
                        account_id=whatsapp_account.account_id,
                        channel_id=whatsapp_account.channel_id,
                        conversation_id=conversation.id,
                        source="live",
                        outcome="skip",
                        reason_code="escalated",
                        reason_text="المحادثة محوّلة لموظف — توقف الرد الآلي",
                        query_text=text_body,
                    )
                else:
                    if staff_owns and auto_reply_inbound:
                        # Keep staff suggestions; never auto-send when a human owns the chat.
                        auto_reply_inbound = False
                        await log_ai_activity(
                            db,
                            account_id=whatsapp_account.account_id,
                            channel_id=whatsapp_account.channel_id,
                            conversation_id=conversation.id,
                            source="live",
                            outcome="skip",
                            reason_code="staff_assigned",
                            reason_text="استلم الموظف المحادثة — توقف الإرسال التلقائي",
                            query_text=text_body,
                        )

                    ai_result = await suggest_smart_reply(
                        db,
                        account_id=whatsapp_account.account_id,
                        query=text_body,
                        contact_name=contact.display_name or "",
                        mode=default_mode,
                        use_llm=bool(agent_settings.get("llm_enabled")),
                        channel_id=whatsapp_account.channel_id,
                        dialogue_state=dialogue_state,
                    )
                    next_dialogue = ai_result.get("dialogue")
                    if isinstance(next_dialogue, dict) and next_dialogue:
                        await save_catalog_dialogue(
                            account_id=whatsapp_account.account_id,
                            conversation_id=conversation.id,
                            state=next_dialogue,
                        )
                    escalated_now = bool((next_dialogue or {}).get("escalated")) or str(
                        ai_result.get("source") or ""
                    ) == "escalate"
                    if auto_kb_on_inbound or auto_reply_inbound or escalated_now:
                        ai_event_type = "ai.kb_suggestion"
                        source = str(ai_result.get("source") or "")
                        if source == "escalate":
                            ai_event_type = "ai.escalated"
                        elif source.startswith("catalog"):
                            ai_event_type = "ai.catalog_suggestion"
                        elif source.startswith("combined"):
                            ai_event_type = "ai.combined_suggestion"
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
                                "needs_clarification": ai_result.get("needs_clarification"),
                                "engine": ai_result.get("engine"),
                                "mode": default_mode,
                                "auto_replied": False,
                                "escalated": escalated_now,
                            },
                        )
                        await log_ai_activity(
                            db,
                            account_id=whatsapp_account.account_id,
                            channel_id=whatsapp_account.channel_id,
                            conversation_id=conversation.id,
                            source="live",
                            outcome="escalate" if escalated_now else "suggest_staff",
                            reason_code=str(ai_result.get("source") or "suggest"),
                            reason_text=(
                                str(ai_result.get("reason_text") or "تم تحويل المحادثة لموظف")
                                if escalated_now
                                else "اقتراح للموظف داخل الوارد"
                            ),
                            query_text=text_body,
                            suggestion=ai_result.get("suggestion"),
                            engine=ai_result.get("engine"),
                        )

            auto_sent = False
            suggestion_text = str(ai_result.get("suggestion") or "").strip()
            window = compute_service_window(conversation.last_message_at)
            can_send = bool(window.get("service_window_open")) and power_flags.get(
                "ai_agent_auto_reply", True
            )

            if agent_live and auto_reply_inbound and can_send and suggestion_text:
                try:
                    await send_text_message(
                        db,
                        account_id=whatsapp_account.account_id,
                        whatsapp_account_id=whatsapp_account.id,
                        payload=SendTextMessageRequest(to=sender, text=suggestion_text),
                        record_mac=True,
                        mac_trigger_source=MacTriggerSource.AI_OUTBOUND,
                    )
                    if not conversation.first_response_at:
                        conversation.first_response_at = datetime.now(UTC)
                    auto_sent = True
                    await publish_event(
                        whatsapp_account.account_id,
                        {
                            "type": "ai.auto_reply_sent",
                            "conversation_id": str(conversation.id),
                            "suggestion": suggestion_text,
                            "source": ai_result.get("source"),
                            "mode": default_mode,
                        },
                    )
                    await log_ai_activity(
                        db,
                        account_id=whatsapp_account.account_id,
                        channel_id=whatsapp_account.channel_id,
                        conversation_id=conversation.id,
                        source="live",
                        outcome="auto_customer",
                        reason_code="auto_reply",
                        reason_text="المساعد رد على العميل تلقائياً",
                        query_text=text_body,
                        suggestion=suggestion_text,
                        engine=ai_result.get("engine"),
                    )
                except ValueError:
                    pass

            if agent_live and (auto_sent or escalated_now):
                try:
                    from app.services.ai_agent_skills import apply_inbound_skills

                    skill_result = await apply_inbound_skills(
                        db,
                        account_id=whatsapp_account.account_id,
                        conversation=conversation,
                        contact=contact,
                        agent_settings=agent_settings,
                        inbound_text=text_body,
                        escalated=escalated_now,
                        auto_sent=auto_sent,
                    )
                    if skill_result.get("applied"):
                        await db.commit()
                        await log_ai_activity(
                            db,
                            account_id=whatsapp_account.account_id,
                            channel_id=whatsapp_account.channel_id,
                            conversation_id=conversation.id,
                            source="live",
                            outcome="skill",
                            reason_code="ai_agent_skills",
                            reason_text="تم تطبيق مهارات الوكيل",
                            query_text=text_body,
                            suggestion=str(skill_result.get("applied"))[:500],
                        )
                except Exception:
                    pass

            # Welcome / outside-hours can run from their own toggles while account AI is on,
            # even when the channel is in staff-handles mode (no suggest/auto).
            account_on = bool(agent_settings.get("account_agent_enabled", True))
            service_replies_ok = account_on and can_send and not conversation.first_response_at

            if (
                not auto_sent
                and service_replies_ok
                and auto_reply_outside_hours
                and not within_hours
            ):
                outside_text = str(agent_settings.get("outside_hours_message") or "").strip()
                if not outside_text:
                    try:
                        local_outside = await suggest_smart_reply(
                            db,
                            account_id=whatsapp_account.account_id,
                            query=text_body,
                            contact_name=contact.display_name or "",
                            mode=default_mode,
                            use_llm=False,
                            channel_id=whatsapp_account.channel_id,
                        )
                        outside_text = str(local_outside.get("suggestion") or "").strip()
                    except Exception:
                        outside_text = ""
                if not outside_text:
                    outside_text = "شكراً لتواصلك. نحن خارج ساعات العمل حالياً وسنرد عليك في أقرب وقت."
                try:
                    await send_text_message(
                        db,
                        account_id=whatsapp_account.account_id,
                        whatsapp_account_id=whatsapp_account.id,
                        payload=SendTextMessageRequest(to=sender, text=outside_text),
                        record_mac=True,
                        mac_trigger_source=MacTriggerSource.AI_OUTBOUND,
                    )
                    conversation.first_response_at = datetime.now(UTC)
                    auto_sent = True
                    await log_ai_activity(
                        db,
                        account_id=whatsapp_account.account_id,
                        channel_id=whatsapp_account.channel_id,
                        conversation_id=conversation.id,
                        source="live",
                        outcome="outside_hours",
                        reason_code="outside_hours_internal",
                        reason_text="رد خارج الدوام عبر المحرك الداخلي",
                        query_text=text_body,
                        suggestion=outside_text,
                        engine="local",
                    )
                except ValueError:
                    pass

            welcome_on = bool(agent_settings.get("welcome_message_enabled", False))
            if (
                not auto_sent
                and service_replies_ok
                and welcome_on
            ):
                welcome_text = str(agent_settings.get("welcome_message") or "").strip()
                if not welcome_text:
                    welcome_text = (
                        "شكراً لتواصلك معنا. يسعدنا خدمتك — كيف يمكننا مساعدتك اليوم؟"
                    )
                try:
                    await send_text_message(
                        db,
                        account_id=whatsapp_account.account_id,
                        whatsapp_account_id=whatsapp_account.id,
                        payload=SendTextMessageRequest(to=sender, text=welcome_text),
                        record_mac=True,
                        mac_trigger_source=MacTriggerSource.AI_OUTBOUND,
                    )
                    conversation.first_response_at = datetime.now(UTC)
                    await log_ai_activity(
                        db,
                        account_id=whatsapp_account.account_id,
                        channel_id=whatsapp_account.channel_id,
                        conversation_id=conversation.id,
                        source="live",
                        outcome="welcome",
                        reason_code="welcome_first_message",
                        reason_text="رسالة ترحيب لأول رسالة واردة",
                        query_text=text_body,
                        suggestion=welcome_text,
                    )
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
