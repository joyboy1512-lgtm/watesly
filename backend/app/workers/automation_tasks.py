import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import httpx
from sqlalchemy import delete, select

from app.db.session import AsyncSessionFactory
from app.models.automation import Automation
from app.models.automation_run import AutomationRun, AutomationRunStatus
from app.models.automation_run_step import AutomationRunStep, AutomationStepStatus
from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_tag import ConversationTag
from app.models.deal import Deal
from app.models.membership import Membership
from app.models.tag import Tag
from app.models.team_member import TeamMember
from app.schemas.whatsapp import SendTextMessageRequest
from app.services.whatsapp import send_text_message
from app.workers.celery_app import celery_app

SYNC_DELAY_MAX_SECONDS = 30


def _evaluate_condition(config, context):
    field = str(config.get("field") or "trigger.text").strip()
    if field and not field.startswith("trigger."):
        if field.startswith("message."):
            field = f"trigger.{field}"
        elif field in {
            "text", "from", "conversation_id", "contact_id", "whatsapp_account_id",
            "channel_id", "organization_id", "tag_id", "button_id", "button_title",
        }:
            field = f"trigger.{field}"
    actual = context
    for part in field.split("."):
        if part:
            actual = actual.get(part) if isinstance(actual, dict) else None
    op = config.get("operator", "equals")
    expected = config.get("value")
    return {
        "equals": actual == expected,
        "not_equals": actual != expected,
        "contains": str(expected).lower() in str(actual or "").lower(),
        "starts_with": str(actual or "").lower().startswith(str(expected).lower()),
        "exists": actual is not None,
    }.get(op, False)


def _delay_seconds(data: dict) -> int:
    seconds = int(data.get("seconds") or 0)
    minutes = int(data.get("minutes") or 0)
    return min(max(seconds + minutes * 60, 0), 86400)


async def _guard(db, run):
    await db.refresh(run)
    now = datetime.now(UTC)
    if run.cancellation_requested_at:
        run.status = AutomationRunStatus.STOPPED
        run.error_message = "Cancellation requested"
        run.finished_at = now
        await db.commit()
        raise asyncio.CancelledError()
    if run.deadline_at and now >= run.deadline_at:
        raise TimeoutError("Automation execution deadline exceeded")
    if run.step_count >= run.max_steps:
        raise RuntimeError("Automation exceeded maximum execution steps")


def _uuid(config, context, key):
    value = config.get(key) or context.get(key) or (context.get("trigger") or {}).get(key)
    return UUID(str(value)) if value else None


async def _maybe_send_text(db, run, data, context, text: str) -> dict | None:
    wa_id = _uuid(data, context, "whatsapp_account_id")
    to = data.get("to") or context.get("to") or (context.get("trigger") or {}).get("from")
    if not wa_id or not to or not text.strip():
        return None
    msg = await send_text_message(
        db,
        account_id=run.account_id,
        whatsapp_account_id=wa_id,
        payload=SendTextMessageRequest(to=str(to), text=text.strip()),
    )
    return {"message_id": str(msg.id), "status": msg.status.value}


async def _action(db, run, node_type, data, context):
    conv_id = _uuid(data, context, "conversation_id")
    if node_type in {"add_tag", "remove_tag", "assign_team", "assign_user", "set_status"} and not conv_id:
        raise ValueError(f"{node_type} requires conversation_id")
    conv = await db.get(Conversation, conv_id) if conv_id else None
    if conv_id and (not conv or conv.account_id != run.account_id or conv.deleted_at is not None):
        raise ValueError("Conversation not available")

    if node_type == "add_tag":
        tag_id = _uuid(data, context, "tag_id")
        tag = await db.get(Tag, tag_id) if tag_id else None
        if not tag or tag.account_id != run.account_id:
            raise ValueError("Tag not available")
        exists = (
            await db.execute(
                select(ConversationTag).where(
                    ConversationTag.conversation_id == conv.id,
                    ConversationTag.tag_id == tag.id,
                )
            )
        ).scalar_one_or_none()
        if not exists:
            db.add(ConversationTag(conversation_id=conv.id, tag_id=tag.id))
        return {"tag_added": str(tag.id)}

    if node_type == "remove_tag":
        tag_id = _uuid(data, context, "tag_id")
        await db.execute(
            delete(ConversationTag).where(
                ConversationTag.conversation_id == conv.id,
                ConversationTag.tag_id == tag_id,
            )
        )
        return {"tag_removed": str(tag_id)}

    if node_type == "assign_user":
        membership_id = _uuid(data, context, "membership_id")
        membership = await db.get(Membership, membership_id) if membership_id else None
        if not membership or membership.account_id != run.account_id:
            raise ValueError("Membership not available")
        conv.assigned_membership_id = membership.id
        return {"assigned_membership_id": str(membership.id)}

    if node_type == "assign_team":
        team_id = _uuid(data, context, "team_id")
        membership_id = (
            await db.execute(
                select(TeamMember.membership_id)
                .join(Membership, Membership.id == TeamMember.membership_id)
                .where(TeamMember.team_id == team_id, Membership.account_id == run.account_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if not membership_id:
            raise ValueError("Team has no available member")
        conv.assigned_membership_id = membership_id
        return {"assigned_membership_id": str(membership_id)}

    if node_type == "set_status":
        conv.status = ConversationStatus(str(data.get("status", "open")))
        return {"status": conv.status.value}

    if node_type == "send_text":
        text = str(data.get("text") or "").strip()
        if not text:
            raise ValueError("send_text requires text")
        sent = await _maybe_send_text(db, run, data, context, text)
        if not sent:
            raise ValueError("send_text requires whatsapp_account_id, to and text")
        return sent

    if node_type == "send_quick_reply":
        from app.models.quick_reply import QuickReply
        from app.services.variables import build_contact_context, render_template

        reply_id = _uuid(data, context, "quick_reply_id")
        if not reply_id:
            raise ValueError("send_quick_reply requires quick_reply_id")
        reply = await db.get(QuickReply, reply_id)
        if reply is None or reply.account_id != run.account_id or not reply.is_active:
            raise ValueError("Quick reply not found")
        text = reply.body
        contact_id = context.get("contact_id") or (context.get("trigger") or {}).get("contact_id")
        if contact_id:
            from app.models.contact import Contact

            contact = await db.get(Contact, contact_id)
            if contact is not None:
                text = render_template(text, build_contact_context(contact))
        sent = await _maybe_send_text(db, run, data, context, text)
        if not sent:
            raise ValueError("send_quick_reply requires whatsapp_account_id, to and text")
        reply.usage_count = (reply.usage_count or 0) + 1
        await db.flush()
        return {**sent, "quick_reply_id": str(reply.id), "title": reply.title}

    if node_type == "send_media":
        from app.models.message import MessageType

        media_type = str(data.get("media_type") or "image").lower()
        media_url = str(data.get("media_url") or data.get("url") or "").strip()
        if not media_url:
            raise ValueError("send_media requires media_url")
        caption = str(data.get("caption") or data.get("text") or "").strip() or None
        filename = str(data.get("filename") or "").strip() or None
        type_map = {
            "image": MessageType.IMAGE,
            "video": MessageType.VIDEO,
            "audio": MessageType.AUDIO,
            "document": MessageType.DOCUMENT,
        }
        resolved = type_map.get(media_type)
        if resolved is None:
            raise ValueError("send_media supports image, video, audio, document")
        from app.schemas.whatsapp_media import SendMediaMessageRequest
        from app.services.whatsapp import send_media_message

        wa_id = _uuid(data, context, "whatsapp_account_id")
        to = data.get("to") or context.get("to") or (context.get("trigger") or {}).get("from")
        if not wa_id or not to:
            raise ValueError("send_media requires whatsapp_account_id and recipient phone")
        msg = await send_media_message(
            db,
            account_id=run.account_id,
            whatsapp_account_id=wa_id,
            media_type=resolved,
            payload=SendMediaMessageRequest(
                to=str(to),
                media_url=media_url,
                caption=caption,
                filename=filename,
            ),
        )
        return {"message_id": str(msg.id), "status": msg.status.value, "media_type": media_type}

    if node_type == "send_catalog":
        from app.services.catalog import suggest_catalog_reply

        trigger = context.get("trigger") or {}
        query = str(data.get("query") or trigger.get("text") or "").strip()
        result = await suggest_catalog_reply(
            db,
            account_id=run.account_id,
            query=query,
            contact_name=str(data.get("contact_name") or ""),
        )
        if data.get("auto_send", True):
            sent = await _maybe_send_text(db, run, data, context, str(result.get("suggestion") or ""))
            if sent:
                return {**result, **sent}
        return result

    if node_type == "ai_reply":
        from app.services.knowledge_base import suggest_smart_reply

        trigger = context.get("trigger") or {}
        query = str(data.get("query") or trigger.get("text") or "").strip()
        contact_name = str(data.get("contact_name") or "")
        mode = str(data.get("mode") or "kb_first")
        result = await suggest_smart_reply(
            db,
            account_id=run.account_id,
            query=query,
            contact_name=contact_name,
            mode=mode,
        )
        if data.get("auto_send", True):
            sent = await _maybe_send_text(db, run, data, context, str(result.get("suggestion") or ""))
            if sent:
                return {**result, **sent}
        return result

    if node_type == "create_deal":
        title = str(data.get("title") or "فرصة من الأتمتة").strip()
        contact_id = _uuid(data, context, "contact_id")
        deal = Deal(
            account_id=run.account_id,
            contact_id=contact_id,
            title=title[:200],
            stage=str(data.get("stage") or "lead"),
            amount=Decimal(str(data.get("amount") or "0")),
            pipeline=str(data.get("pipeline") or "default"),
        )
        db.add(deal)
        await db.flush()
        return {"deal_id": str(deal.id), "stage": deal.stage, "title": deal.title}

    if node_type == "webhook":
        url = str(data.get("url") or "")
        if not url.startswith("https://"):
            raise ValueError("Webhook URL must use HTTPS")
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.post(
                url, json={"run_id": str(run.id), "context": context, "data": data}
            )
            response.raise_for_status()
        return {"status_code": response.status_code}

    if node_type == "http_request":
        from app.services.feature_flags import get_feature_flags

        flags = await get_feature_flags(db, account_id=run.account_id)
        if not flags.get("http_automation_requests", True):
            raise ValueError("HTTP automation requests are disabled for this account")
        method = str(data.get("method") or "POST").upper()
        url = str(data.get("url") or "")
        if not url.startswith("https://"):
            raise ValueError("HTTP request URL must use HTTPS")
        headers = data.get("headers") if isinstance(data.get("headers"), dict) else {}
        body = data.get("body") if isinstance(data.get("body"), dict) else {"run_id": str(run.id), "context": context}
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.request(method, url, json=body, headers=headers)
            response.raise_for_status()
        return {"status_code": response.status_code, "method": method}

    if node_type == "set_lifecycle":
        from app.models.contact import Contact

        contact_id = _uuid(data, context, "contact_id")
        stage = str(data.get("lifecycle_stage") or data.get("stage") or "lead").strip()[:30]
        if not contact_id:
            raise ValueError("set_lifecycle requires contact_id")
        contact = await db.get(Contact, contact_id)
        if contact is None or contact.account_id != run.account_id or contact.deleted_at is not None:
            raise ValueError("Contact not available")
        contact.lifecycle_stage = stage or "lead"
        return {"lifecycle_stage": contact.lifecycle_stage}

    if node_type == "collect_input":
        from app.services.feature_flags import get_feature_flags

        flags = await get_feature_flags(db, account_id=run.account_id)
        if not flags.get("collect_input_forms"):
            raise ValueError("collect_input requires collect_input_forms feature flag")
        prompt = str(data.get("prompt_text") or data.get("text") or "").strip()
        field_key = str(data.get("field_key") or "input").strip()[:60]
        if not prompt:
            raise ValueError("collect_input requires prompt_text")
        sent = await _maybe_send_text(db, run, data, context, prompt)
        if not sent:
            raise ValueError("collect_input requires whatsapp_account_id and recipient phone")
        return {
            **sent,
            "field_key": field_key,
            "awaiting_reply": True,
            "hint": "Use message_received automation with condition on trigger.text",
        }

    if node_type == "send_template":
        template_id = _uuid(data, context, "template_id")
        wa_id = _uuid(data, context, "whatsapp_account_id")
        to = data.get("to") or context.get("to") or (context.get("trigger") or {}).get("from")
        if not template_id or not wa_id or not to:
            raise ValueError("send_template requires template_id, whatsapp_account_id and to")
        from app.models.whatsapp_template import WhatsAppTemplate
        from app.schemas.whatsapp_media import SendTemplateMessageRequest
        from app.services.whatsapp import send_template_message

        template = await db.get(WhatsAppTemplate, template_id)
        if not template or template.account_id != run.account_id:
            raise ValueError("Template not available")
        params = data.get("template_parameters") or data.get("components") or []
        from app.services.template_media import resolve_send_components

        components = resolve_send_components(
            template.components,
            params if isinstance(params, list) and params else None,
            media_url=data.get("media_url"),
            filename=data.get("filename"),
        )
        msg = await send_template_message(
            db,
            account_id=run.account_id,
            whatsapp_account_id=wa_id,
            payload=SendTemplateMessageRequest(
                to=str(to),
                template_name=template.name,
                language_code=template.language,
                components=components,
            ),
        )
        return {"message_id": str(msg.id), "status": msg.status.value}

    raise ValueError(f"Unsupported action node: {node_type}")


async def _schedule_delay_resume(db, run, *, delay_seconds: int, next_targets: list[str], context: dict) -> None:
    from app.services.scheduler import schedule_job

    resume_context = {**context, "resume_queue": next_targets}
    run.context = resume_context
    run.status = AutomationRunStatus.WAITING
    await db.commit()
    await schedule_job(
        db,
        account_id=run.account_id,
        job_type="automation.resume",
        payload={"run_id": str(run.id)},
        run_at=datetime.now(UTC) + timedelta(seconds=delay_seconds),
    )


async def _execute_run(run_id):
    async with AsyncSessionFactory() as db:
        run = await db.get(AutomationRun, run_id)
        if not run:
            return {"status": "not_found"}
        if run.status in {
            AutomationRunStatus.SUCCEEDED,
            AutomationRunStatus.FAILED,
            AutomationRunStatus.STOPPED,
        }:
            return {"status": "already_finished", "run_status": run.status.value}

        try:
            automation = await db.get(Automation, run.automation_id)
            if not automation:
                raise ValueError("Automation not found")

            nodes = {node["id"]: node for node in automation.graph.get("nodes", [])}
            edges = automation.graph.get("edges", [])
            outgoing = {node_id: [] for node_id in nodes}
            for edge in edges:
                outgoing.setdefault(edge["source"], []).append(edge)

            trigger = next((node for node in nodes.values() if node.get("type") == "trigger"), None)
            if not trigger:
                raise ValueError("Automation trigger is missing")

            stored_context = dict(run.context or {})
            resume_queue = stored_context.pop("resume_queue", None)
            if run.status == AutomationRunStatus.WAITING and resume_queue:
                context = stored_context
                queue = list(resume_queue)
            else:
                context = {"trigger": run.trigger_payload}
                queue = [trigger["id"]]

            run.status = AutomationRunStatus.RUNNING
            run.started_at = run.started_at or datetime.now(UTC)
            run.context = context
            await db.commit()

            while queue:
                await _guard(db, run)
                node_id = queue.pop(0)
                node = nodes.get(node_id)
                if not node:
                    raise ValueError(f"Automation node not found: {node_id}")

                run.current_node_id = node_id
                step = AutomationRunStep(
                    run_id=run.id,
                    node_id=node_id,
                    node_type=node["type"],
                    status=AutomationStepStatus.RUNNING,
                    input_data=context,
                    started_at=datetime.now(UTC),
                )
                db.add(step)
                await db.flush()

                next_edges = outgoing.get(node_id, [])
                node_type = node["type"]
                data = node.get("data", {})

                if node_type == "condition":
                    result = _evaluate_condition(data, context)
                    output = {"result": result}
                    desired = "true" if result else "false"
                    next_edges = [
                        edge
                        for edge in next_edges
                        if (edge.get("source_handle") or edge.get("label") or "").lower() == desired
                    ]
                elif node_type == "delay":
                    total_seconds = _delay_seconds(data)
                    next_targets = [edge["target"] for edge in next_edges]
                    if total_seconds > SYNC_DELAY_MAX_SECONDS:
                        step.status = AutomationStepStatus.SUCCEEDED
                        step.output_data = {"delayed_seconds": total_seconds, "scheduled": True}
                        step.finished_at = datetime.now(UTC)
                        run.step_count += 1
                        await db.commit()
                        await _schedule_delay_resume(
                            db, run, delay_seconds=total_seconds, next_targets=next_targets, context=context
                        )
                        return {"status": "waiting", "delayed_seconds": total_seconds}
                    for _ in range(total_seconds):
                        await asyncio.sleep(1)
                        await _guard(db, run)
                    output = {"delayed_seconds": total_seconds}
                elif node_type == "stop":
                    next_edges = []
                    output = {"stopped": True}
                elif node_type == "trigger":
                    output = {"triggered": True}
                else:
                    output = await _action(db, run, node_type, data, context)

                step.status = AutomationStepStatus.SUCCEEDED
                step.output_data = output
                step.finished_at = datetime.now(UTC)
                run.step_count += 1
                context.setdefault("steps", {})[node_id] = output
                run.context = context
                await db.commit()
                queue.extend(edge["target"] for edge in next_edges)

            run.status = AutomationRunStatus.SUCCEEDED
            run.current_node_id = None
            run.finished_at = datetime.now(UTC)
            await db.commit()
            return {"status": "succeeded", "steps": run.step_count}
        except asyncio.CancelledError:
            return {"status": "stopped", "steps": run.step_count}
        except Exception as exc:
            run.status = AutomationRunStatus.FAILED
            run.error_message = str(exc)[:2000]
            run.finished_at = datetime.now(UTC)
            await db.commit()
            return {"status": "failed", "error": str(exc), "steps": run.step_count}


@celery_app.task(name="watesly.automations.execute")
def execute_automation_run(run_id: str) -> dict:
    return asyncio.run(_execute_run(UUID(run_id)))
