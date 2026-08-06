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

    return True


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

    for automation in automations:
        node_count = len(automation.graph.get("nodes", []))
        run = AutomationRun(
            automation_id=automation.id,
            account_id=account_id,
            status=AutomationRunStatus.QUEUED,
            trigger_payload=trigger_payload,
            context={},
            started_at=None,
            max_steps=min(max(node_count * 3, 25), 500),
            deadline_at=datetime.now(UTC) + run_deadline_for_graph(automation.graph),
        )
        db.add(run)
        await db.flush()
        run_ids.append(run.id)

    return run_ids
