from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import (
    Automation,
    AutomationStatus,
)
from app.models.automation_run import AutomationRun, AutomationRunStatus
from app.models.organization import Organization
from app.services.outbox import add_outbox_event
from app.schemas.automation import (
    AutomationCreateRequest,
    AutomationUpdateRequest,
)


SUPPORTED_NODE_TYPES = {
    "trigger",
    "condition",
    "send_text",
    "send_quick_reply",
    "send_template",
    "send_media",
    "send_catalog",
    "ai_reply",
    "create_deal",
    "add_tag",
    "remove_tag",
    "assign_team",
    "assign_user",
    "set_status",
    "delay",
    "webhook",
    "stop",
}


def estimate_graph_delay_seconds(graph: dict) -> int:
    total = 0
    for node in graph.get("nodes", []):
        if node.get("type") != "delay":
            continue
        data = node.get("data") or {}
        total += int(data.get("seconds") or 0) + int(data.get("minutes") or 0) * 60
    return total


def run_deadline_for_graph(graph: dict) -> timedelta:
    delay_seconds = estimate_graph_delay_seconds(graph)
    return timedelta(minutes=max(15, 15 + delay_seconds // 60))


def validate_publishable_graph(graph: dict) -> None:
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    if not nodes:
        raise ValueError("AUTOMATION_GRAPH_EMPTY")

    node_map = {node["id"]: node for node in nodes}
    trigger_nodes = [node for node in nodes if node.get("type") == "trigger"]
    if len(trigger_nodes) != 1:
        raise ValueError("AUTOMATION_REQUIRES_ONE_TRIGGER")

    for node in nodes:
        if node.get("type") not in SUPPORTED_NODE_TYPES:
            raise ValueError("UNSUPPORTED_NODE_TYPE")

    outgoing = {node_id: [] for node_id in node_map}
    incoming = {node_id: [] for node_id in node_map}
    for edge in edges:
        source = edge["source"]
        target = edge["target"]
        if source not in node_map or target not in node_map:
            raise ValueError("INVALID_EDGE")
        outgoing[source].append(target)
        incoming[target].append(source)

    trigger_id = trigger_nodes[0]["id"]
    visited: set[str] = set()
    stack = [trigger_id]
    while stack:
        node_id = stack.pop()
        if node_id in visited:
            continue
        visited.add(node_id)
        stack.extend(outgoing[node_id])

    if visited != set(node_map):
        raise ValueError("AUTOMATION_HAS_UNREACHABLE_NODES")

    # Detect cycles. Delay/retry loops will be introduced later with explicit loop nodes.
    visiting: set[str] = set()
    completed: set[str] = set()

    def dfs(node_id: str) -> None:
        if node_id in visiting:
            raise ValueError("AUTOMATION_GRAPH_CYCLE")
        if node_id in completed:
            return
        visiting.add(node_id)
        for target in outgoing[node_id]:
            dfs(target)
        visiting.remove(node_id)
        completed.add(node_id)

    dfs(trigger_id)


async def create_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    payload: AutomationCreateRequest,
) -> Automation:
    organization = await db.get(Organization, payload.organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")

    item = Automation(
        account_id=account_id,
        organization_id=payload.organization_id,
        created_by_user_id=user_id,
        name=payload.name,
        description=payload.description,
        trigger_type=payload.trigger_type,
        trigger_config=payload.trigger_config,
        graph=payload.graph.model_dump(),
        status=AutomationStatus.DRAFT,
    )
    db.add(item)
    await db.flush()
    await add_outbox_event(db, account_id=account_id, event_type="automation.created", aggregate_type="automation", aggregate_id=str(item.id), payload={"automation_id": str(item.id)})
    await db.commit()
    await db.refresh(item)
    return item


async def list_automations(db: AsyncSession, account_id: UUID) -> list[Automation]:
    result = await db.execute(
        select(Automation)
        .where(Automation.account_id == account_id)
        .order_by(Automation.updated_at.desc())
    )
    return list(result.scalars().all())


async def get_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
) -> Automation:
    item = await db.get(Automation, automation_id)
    if item is None or item.account_id != account_id:
        raise ValueError("AUTOMATION_NOT_FOUND")
    return item


async def update_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    payload: AutomationUpdateRequest,
) -> Automation:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
    )
    changes = payload.model_dump(exclude_unset=True)
    graph = changes.pop("graph", None)
    for key, value in changes.items():
        setattr(item, key, value)
    if graph is not None:
        item.graph = graph.model_dump() if hasattr(graph, "model_dump") else graph
    item.version += 1
    if item.status == AutomationStatus.ACTIVE and graph is not None:
        item.status = AutomationStatus.DRAFT
    await db.commit()
    await db.refresh(item)
    return item


async def publish_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
) -> Automation:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
    )
    validate_publishable_graph(item.graph)
    item.status = AutomationStatus.ACTIVE
    item.version += 1
    await add_outbox_event(db, account_id=account_id, event_type="automation.published", aggregate_type="automation", aggregate_id=str(item.id), payload={"automation_id": str(item.id), "version": item.version})
    await db.commit()
    await db.refresh(item)
    return item


async def pause_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
) -> Automation:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
    )
    item.status = AutomationStatus.PAUSED
    await db.commit()
    await db.refresh(item)
    return item


async def create_test_run(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    trigger_payload: dict,
) -> AutomationRun:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
    )
    validate_publishable_graph(item.graph)
    run = AutomationRun(
        automation_id=item.id,
        account_id=account_id,
        status=AutomationRunStatus.QUEUED,
        trigger_payload=trigger_payload,
        context={},
        started_at=None,
        max_steps=min(max(len(item.graph.get("nodes", [])) * 3, 25), 500),
        deadline_at=datetime.now(UTC) + run_deadline_for_graph(item.graph),
    )
    db.add(run)
    await db.flush()
    await db.commit()
    await db.refresh(run)
    return run


async def list_runs(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
) -> list[AutomationRun]:
    await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
    )
    result = await db.execute(
        select(AutomationRun)
        .where(AutomationRun.automation_id == automation_id)
        .order_by(AutomationRun.created_at.desc())
        .limit(100)
    )
    return list(result.scalars().all())


async def get_automation_stats(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
) -> dict:
    from sqlalchemy import func

    await get_automation(db, account_id=account_id, automation_id=automation_id)
    rows = await db.execute(
        select(AutomationRun.status, func.count(AutomationRun.id))
        .where(AutomationRun.automation_id == automation_id)
        .group_by(AutomationRun.status)
    )
    by_status: dict[str, int] = {}
    for status, count in rows.all():
        key = status.value if hasattr(status, "value") else str(status)
        by_status[key] = int(count)
    total = sum(by_status.values())
    succeeded = by_status.get(AutomationRunStatus.SUCCEEDED.value, 0)
    failed = by_status.get(AutomationRunStatus.FAILED.value, 0)
    finished = succeeded + failed + by_status.get(AutomationRunStatus.STOPPED.value, 0)
    last_run = await db.scalar(
        select(func.max(AutomationRun.created_at)).where(AutomationRun.automation_id == automation_id)
    )
    duration_rows = await db.execute(
        select(AutomationRun.started_at, AutomationRun.finished_at)
        .where(
            AutomationRun.automation_id == automation_id,
            AutomationRun.started_at.is_not(None),
            AutomationRun.finished_at.is_not(None),
        )
        .limit(200)
    )
    durations = [
        (finished_at - started_at).total_seconds()
        for started_at, finished_at in duration_rows.all()
        if started_at and finished_at
    ]
    avg_duration = round(sum(durations) / len(durations), 2) if durations else None
    return {
        "total_runs": total,
        "by_status": by_status,
        "success_rate": round((succeeded / finished) * 100, 1) if finished else 0.0,
        "avg_duration_seconds": avg_duration,
        "last_run_at": last_run.isoformat() if last_run else None,
    }


async def request_run_cancellation(
    db: AsyncSession, *, account_id: UUID, run_id: UUID
) -> AutomationRun:
    run = await db.get(AutomationRun, run_id)
    if run is None or run.account_id != account_id:
        raise ValueError("AUTOMATION_RUN_NOT_FOUND")
    if run.status in {AutomationRunStatus.SUCCEEDED, AutomationRunStatus.FAILED, AutomationRunStatus.STOPPED}:
        raise ValueError("AUTOMATION_RUN_ALREADY_FINISHED")
    run.cancellation_requested_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(run)
    return run
