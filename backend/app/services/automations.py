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
    "business_hours",
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
    "set_lifecycle",
    "collect_input",
    "delay",
    "webhook",
    "http_request",
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
    membership=None,
) -> Automation:
    from app.services.membership_access import ensure_membership_organization_access

    organization = await db.get(Organization, payload.organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    if membership is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=payload.organization_id,
        )

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


async def list_automations(
    db: AsyncSession,
    account_id: UUID,
    *,
    membership=None,
) -> list[Automation]:
    from app.services.membership_access import organization_scope_clauses

    query = select(Automation).where(Automation.account_id == account_id)
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=Automation.organization_id,
        ):
            query = query.where(clause)
    query = query.order_by(Automation.updated_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    membership=None,
) -> Automation:
    from app.services.membership_access import ensure_membership_organization_access

    item = await db.get(Automation, automation_id)
    if item is None or item.account_id != account_id:
        raise ValueError("AUTOMATION_NOT_FOUND")
    if membership is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=item.organization_id,
        )
    return item


async def update_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    payload: AutomationUpdateRequest,
    membership=None,
) -> Automation:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
        membership=membership,
    )
    changes = payload.model_dump(exclude_unset=True)
    graph = changes.pop("graph", None)
    for key, value in changes.items():
        setattr(item, key, value)
    if graph is not None:
        item.graph = graph.model_dump() if hasattr(graph, "model_dump") else graph
    item.version += 1
    # Keep ACTIVE live on published_graph; draft edits stay in graph until republish.
    # Status flips to DRAFT only when there is no published snapshot yet.
    if item.status == AutomationStatus.ACTIVE and graph is not None and not item.published_graph:
        item.status = AutomationStatus.DRAFT
    await db.commit()
    await db.refresh(item)
    return item


async def publish_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    membership=None,
) -> Automation:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
        membership=membership,
    )
    validate_publishable_graph(item.graph)
    item.status = AutomationStatus.ACTIVE
    item.published_graph = item.graph
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
    membership=None,
) -> Automation:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
        membership=membership,
    )
    item.status = AutomationStatus.PAUSED
    await db.commit()
    await db.refresh(item)
    return item


def _simulate_condition(config: dict, context: dict) -> bool:
    field = str(config.get("field") or "trigger.text").strip()
    if field and not field.startswith("trigger."):
        if field.startswith("message."):
            field = f"trigger.{field}"
        elif field in {
            "text",
            "from",
            "conversation_id",
            "contact_id",
            "whatsapp_account_id",
            "channel_id",
            "organization_id",
            "tag_id",
            "button_id",
            "button_title",
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


def simulate_automation_graph(*, graph: dict, trigger_payload: dict) -> dict:
    """Walk the graph without side effects (no WhatsApp, deals, webhooks)."""
    nodes = {node["id"]: node for node in graph.get("nodes", [])}
    edges = graph.get("edges", [])
    outgoing: dict[str, list] = {node_id: [] for node_id in nodes}
    for edge in edges:
        outgoing.setdefault(edge["source"], []).append(edge)

    trigger = next((node for node in nodes.values() if node.get("type") == "trigger"), None)
    if not trigger:
        raise ValueError("AUTOMATION_REQUIRES_ONE_TRIGGER")

    context: dict = {"trigger": trigger_payload}
    queue = [trigger["id"]]
    steps: list[dict] = []
    visited = 0
    max_steps = min(max(len(nodes) * 3, 25), 200)
    would_send: list[str] = []
    would_create_deal = False
    would_assign_team = False
    ai_reply_would_run = False

    while queue and visited < max_steps:
        node_id = queue.pop(0)
        node = nodes.get(node_id)
        if not node:
            break
        visited += 1
        node_type = node.get("type")
        data = node.get("data") or {}
        next_edges = list(outgoing.get(node_id, []))
        output: dict = {}

        if node_type == "condition":
            result = _simulate_condition(data, context)
            output = {"result": result, "matched_field": data.get("field"), "operator": data.get("operator")}
            desired = "true" if result else "false"
            next_edges = [
                edge
                for edge in next_edges
                if (edge.get("source_handle") or edge.get("label") or "").lower() == desired
            ]
        elif node_type == "business_hours":
            # Simulation assumes within hours unless trigger says otherwise.
            result = bool((trigger_payload or {}).get("is_within_business_hours", True))
            output = {"result": result, "assumed": True}
            desired = "true" if result else "false"
            next_edges = [
                edge
                for edge in next_edges
                if (edge.get("source_handle") or edge.get("label") or "").lower() == desired
            ]
        elif node_type == "delay":
            seconds = int(data.get("seconds") or 0) + int(data.get("minutes") or 0) * 60
            output = {"delayed_seconds": seconds, "simulated": True}
        elif node_type == "stop":
            next_edges = []
            output = {"stopped": True}
        elif node_type == "trigger":
            output = {"triggered": True}
        elif node_type in {"send_text", "send_quick_reply", "send_template", "send_media", "send_catalog"}:
            text = str(data.get("text") or data.get("body") or data.get("caption") or "").strip()
            if text:
                would_send.append(text)
            output = {"would_send": True, "preview": text or None, "side_effects": False}
        elif node_type == "ai_reply":
            ai_reply_would_run = True
            output = {
                "would_ai_reply": True,
                "note": "الذكاء الاصطناعي كان سيتولى الرد إذا لم تُنتج الأتمتة رداً مسبقاً",
                "side_effects": False,
            }
        elif node_type == "create_deal":
            would_create_deal = True
            output = {"would_create_deal": True, "title": data.get("title"), "side_effects": False}
        elif node_type == "assign_team":
            would_assign_team = True
            output = {"would_assign_team": True, "team_id": data.get("team_id"), "side_effects": False}
        else:
            output = {"would_run": True, "side_effects": False}

        steps.append(
            {
                "node_id": node_id,
                "node_type": node_type,
                "label": data.get("label") or node_type,
                "output": output,
            }
        )
        context.setdefault("steps", {})[node_id] = output
        queue.extend(edge["target"] for edge in next_edges)

    conflict_note = None
    if ai_reply_would_run and would_send:
        conflict_note = (
            "الأتمتة سترسل رداً قبل عقد الذكاء؛ في التشغيل الفعلي يصل رد واحد من مسار الأتمتة "
            "ما لم يُضبط الرد الآلي ليتوقف عند نجاح الأتمتة."
        )
    elif ai_reply_would_run:
        conflict_note = "عقد الرد الذكي كان سيتولى الرسالة؛ تأكد من عدم تفعيل رد آلي موازٍ على نفس القناة."

    return {
        "dry_run": True,
        "steps": steps,
        "would_send": would_send,
        "proposed_reply": would_send[0] if would_send else None,
        "would_create_deal": would_create_deal,
        "would_assign_team": would_assign_team,
        "ai_reply_would_run": ai_reply_would_run,
        "conflict_note": conflict_note,
        "side_effects_blocked": True,
    }


async def simulate_automation(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    trigger_payload: dict,
    membership=None,
) -> dict:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
        membership=membership,
    )
    try:
        validate_publishable_graph(item.graph)
        validation_ok = True
        validation_error = None
    except ValueError as exc:
        validation_ok = False
        validation_error = str(exc)
    result = simulate_automation_graph(graph=item.graph, trigger_payload=trigger_payload)
    result.update(
        {
            "automation_id": str(item.id),
            "automation_name": item.name,
            "status": item.status.value if hasattr(item.status, "value") else str(item.status),
            "validation_ok": validation_ok,
            "validation_error": validation_error,
        }
    )
    return result


async def create_test_run(
    db: AsyncSession,
    *,
    account_id: UUID,
    automation_id: UUID,
    trigger_payload: dict,
    membership=None,
) -> AutomationRun:
    item = await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
        membership=membership,
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
    membership=None,
) -> list[AutomationRun]:
    await get_automation(
        db,
        account_id=account_id,
        automation_id=automation_id,
        membership=membership,
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
    membership=None,
) -> dict:
    from sqlalchemy import func

    await get_automation(
        db, account_id=account_id, automation_id=automation_id, membership=membership
    )
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
