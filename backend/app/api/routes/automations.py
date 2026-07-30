from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.db.session import get_db
from app.core.permissions import Permission
from app.schemas.automation import (
    AutomationCreateRequest,
    AutomationPublishResponse,
    AutomationResponse,
    AutomationRunResponse,
    AutomationTestRequest,
    AutomationUpdateRequest,
)
from app.services.automations import (
    create_automation,
    create_test_run,
    get_automation,
    get_automation_stats,
    list_automations,
    list_runs,
    pause_automation,
    request_run_cancellation,
    publish_automation,
    update_automation,
)
from app.workers.automation_tasks import execute_automation_run

router = APIRouter()


def _automation_error(exc: ValueError) -> HTTPException:
    mapping = {
        "AUTOMATION_NOT_FOUND": (404, "Automation not found"),
        "INVALID_ORGANIZATION": (400, "Invalid organization"),
        "AUTOMATION_GRAPH_EMPTY": (400, "Automation graph is empty"),
        "AUTOMATION_REQUIRES_ONE_TRIGGER": (400, "Automation requires exactly one trigger"),
        "AUTOMATION_HAS_UNREACHABLE_NODES": (400, "Automation contains unreachable nodes"),
        "AUTOMATION_GRAPH_CYCLE": (400, "Automation graph contains a cycle"),
        "UNSUPPORTED_NODE_TYPE": (400, "Automation contains an unsupported node"),
        "INVALID_EDGE": (400, "Automation contains an invalid edge"),
    }
    code, detail = mapping.get(str(exc), (400, str(exc)))
    return HTTPException(status_code=code, detail=detail)


@router.get("", response_model=list[AutomationResponse])
async def get_automations(
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_automations(db, context.account_id)


@router.post("", response_model=AutomationResponse, status_code=status.HTTP_201_CREATED)
async def post_automation(
    payload: AutomationCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_automation(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            payload=payload,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Automation name already exists") from exc


@router.get("/{automation_id}", response_model=AutomationResponse)
async def get_automation_by_id(
    automation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_automation(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc


@router.patch("/{automation_id}", response_model=AutomationResponse)
async def patch_automation(
    automation_id: UUID,
    payload: AutomationUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_automation(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
            payload=payload,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc


@router.post("/{automation_id}/publish", response_model=AutomationPublishResponse)
async def publish(
    automation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await publish_automation(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc
    return AutomationPublishResponse(id=item.id, status=item.status, version=item.version)


@router.post("/{automation_id}/pause", response_model=AutomationPublishResponse)
async def pause(
    automation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await pause_automation(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc
    return AutomationPublishResponse(id=item.id, status=item.status, version=item.version)


@router.post("/{automation_id}/test", response_model=AutomationRunResponse)
async def test_automation(
    automation_id: UUID,
    payload: AutomationTestRequest,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        run = await create_test_run(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
            trigger_payload=payload.trigger_payload,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc

    execute_automation_run.apply_async(args=[str(run.id)], queue="automations")
    return run


@router.get("/{automation_id}/stats")
async def automation_stats(
    automation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_automation_stats(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc


@router.get("/{automation_id}/runs", response_model=list[AutomationRunResponse])
async def get_runs(
    automation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_runs(
            db,
            account_id=context.account_id,
            automation_id=automation_id,
        )
    except ValueError as exc:
        raise _automation_error(exc) from exc


@router.post("/runs/{run_id}/cancel", response_model=AutomationRunResponse)
async def cancel_run(
    run_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.AUTOMATIONS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await request_run_cancellation(db, account_id=context.account_id, run_id=run_id)
    except ValueError as exc:
        raise _automation_error(exc) from exc
