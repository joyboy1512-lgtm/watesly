from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.models.outbox_event import OutboxEvent
from app.models.scheduled_job import ScheduledJob
from app.models.automation_run import AutomationRun, AutomationRunStatus

router = APIRouter()


@router.get("/summary")
async def operations_summary(
    _: AuthContext = Depends(require_permissions(Permission.OPERATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    outbox_rows = await db.execute(select(OutboxEvent.status, func.count(OutboxEvent.id)).group_by(OutboxEvent.status))
    jobs_rows = await db.execute(select(ScheduledJob.status, func.count(ScheduledJob.id)).group_by(ScheduledJob.status))
    failed_runs = await db.scalar(select(func.count(AutomationRun.id)).where(AutomationRun.status == AutomationRunStatus.FAILED))
    return {
        "outbox": {str(status): count for status, count in outbox_rows.all()},
        "scheduled_jobs": {str(status): count for status, count in jobs_rows.all()},
        "failed_automation_runs": failed_runs or 0,
    }
