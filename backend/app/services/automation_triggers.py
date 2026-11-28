"""Match domain events to active automations and queue runs."""
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import Automation, AutomationStatus, AutomationTriggerType
from app.models.automation_run import AutomationRun, AutomationRunStatus
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.services.automations import run_deadline_for_graph


def dispatch_automation_runs(run_ids: list[UUID]) -> None:
    if not run_ids:
        return
    from app.workers.automation_tasks import execute_automation_run

    for run_id in run_ids:
        execute_automation_run.apply_async(args=[str(run_id)], queue="automations")


async def build_conversation_trigger_payload(
    db: AsyncSession,
    conversation: Conversation,
    **extra: object,
) -> dict:
    contact = await db.get(Contact, conversation.contact_id)
    payload = {
        "organization_id": str(conversation.organization_id),
        "channel_id": str(conversation.channel_id),
        "conversation_id": str(conversation.id),
        "contact_id": str(conversation.contact_id),
        "from": contact.external_address if contact else None,
    }
    payload.update(extra)
    return payload


def _matches_trigger_config(automation: Automation, payload: dict) -> bool:
    config = automation.trigger_config or {}
    if not config:
        return True

    organization_id = payload.get("organization_id")
    if config.get("organization_id") and str(config["organization_id"]) != str(organization_id):
        return False

    channel_id = payload.get("channel_id")
    if config.get("channel_id") and str(config["channel_id"]) != str(channel_id):
        return False

    tag_id = payload.get("tag_id")
    if config.get("tag_id") and str(config["tag_id"]) != str(tag_id):
        return False

    keywords = config.get("keywords")
    if keywords:
        text = str(payload.get("text") or "").lower()
        if not any(str(keyword).lower() in text for keyword in keywords if str(keyword).strip()):
            return False

    button_id = payload.get("button_id")
    config_button_id = config.get("button_id")
    if config_button_id and str(config_button_id) != str(button_id or ""):
        return False

    config_lifecycle = config.get("lifecycle_stage") or config.get("stage")
    if config_lifecycle:
        payload_lifecycle = payload.get("lifecycle_stage") or payload.get("stage")
        if str(config_lifecycle).strip().lower() != str(payload_lifecycle or "").strip().lower():
            return False

    return True


_TERMINAL_LIFECYCLE = frozenset({"won", "lost", "churned", "customer"})


async def stop_open_runs_for_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
) -> int:
    """Stop queued/waiting automation runs tied to a contact (e.g. after won/lost)."""
    contact_key = str(contact_id)
    # Only queued/waiting — never interrupt a run that is actively executing.
    result = await db.execute(
        select(AutomationRun).where(
            AutomationRun.account_id == account_id,
            AutomationRun.status.in_(
                [
                    AutomationRunStatus.QUEUED,
                    AutomationRunStatus.WAITING,
                ]
            ),
        )
    )
    stopped = 0
    for run in result.scalars().all():
        payload = run.trigger_payload if isinstance(run.trigger_payload, dict) else {}
        context = run.context if isinstance(run.context, dict) else {}
        if str(payload.get("contact_id") or "") != contact_key and str(context.get("contact_id") or "") != contact_key:
            continue
        run.status = AutomationRunStatus.STOPPED
        run.error_message = "stopped_by_lifecycle"
        run.finished_at = datetime.now(UTC)
        stopped += 1
    return stopped


async def emit_lifecycle_changed(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact: Contact,
    previous_stage: str | None,
    new_stage: str,
) -> list[UUID]:
    """Queue lifecycle_changed automations; stop open follow-ups on terminal stages."""
    if previous_stage is not None and str(previous_stage) == str(new_stage):
        return []
    payload = {
        "organization_id": str(contact.organization_id),
        "channel_id": str(contact.channel_id),
        "contact_id": str(contact.id),
        "lifecycle_stage": new_stage,
        "previous_lifecycle_stage": previous_stage,
        "from": contact.external_address,
    }
    run_ids = await queue_automation_runs(
        db,
        account_id=account_id,
        trigger_type=AutomationTriggerType.LIFECYCLE_CHANGED,
        trigger_payload=payload,
    )
    if new_stage.strip().lower() in _TERMINAL_LIFECYCLE:
        await stop_open_runs_for_contact(db, account_id=account_id, contact_id=contact.id)
    return run_ids


async def queue_automation_runs(
    db: AsyncSession,
    *,
    account_id: UUID,
    trigger_type: AutomationTriggerType,
    trigger_payload: dict,
) -> list[UUID]:
    organization_id = trigger_payload.get("organization_id")
    if organization_id is None:
        return []

    result = await db.execute(
        select(Automation).where(
            Automation.account_id == account_id,
            Automation.organization_id == UUID(str(organization_id)),
            Automation.status == AutomationStatus.ACTIVE,
            Automation.trigger_type == trigger_type,
        )
    )
    automations = [item for item in result.scalars().all() if _matches_trigger_config(item, trigger_payload)]
    run_ids: list[UUID] = []

    event_key = (
        str(trigger_payload.get("whatsapp_message_id") or trigger_payload.get("message_id") or "").strip()
        or None
    )

    for automation in automations:
        if event_key:
            recent = list(
                (
                    await db.execute(
                        select(AutomationRun)
                        .where(AutomationRun.automation_id == automation.id)
                        .order_by(AutomationRun.created_at.desc())
                        .limit(50)
                    )
                ).scalars().all()
            )
            if any(
                str((run.trigger_payload or {}).get("whatsapp_message_id") or "") == event_key
                or str((run.trigger_payload or {}).get("message_id") or "") == event_key
                for run in recent
            ):
                continue
        live_graph = automation.published_graph or automation.graph or {}
        node_count = len(live_graph.get("nodes", []))
        run = AutomationRun(
            automation_id=automation.id,
            account_id=account_id,
            status=AutomationRunStatus.QUEUED,
            trigger_payload=trigger_payload,
            context={},
            started_at=None,
            max_steps=min(max(node_count * 3, 25), 500),
            deadline_at=datetime.now(UTC) + run_deadline_for_graph(live_graph),
        )
        db.add(run)
        await db.flush()
        run_ids.append(run.id)

    return run_ids
