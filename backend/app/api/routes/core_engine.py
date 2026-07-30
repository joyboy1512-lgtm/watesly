from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.core_engine import (
    ModuleHealthResponse,
    ScheduleJobRequest,
    ScheduledJobResponse,
)
from app.services.health_center import list_module_health
from app.services.scheduler import schedule_job

router = APIRouter()


@router.post(
    "/scheduler/jobs",
    response_model=ScheduledJobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_scheduled_job(
    payload: ScheduleJobRequest,
    context: AuthContext = Depends(require_permissions(Permission.OPERATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await schedule_job(
        db,
        account_id=context.account_id,
        job_type=payload.job_type,
        payload=payload.payload,
        run_at=payload.run_at,
        max_attempts=payload.max_attempts,
    )


@router.get("/health/modules", response_model=list[ModuleHealthResponse])
async def get_module_health(
    _: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_module_health(db)
