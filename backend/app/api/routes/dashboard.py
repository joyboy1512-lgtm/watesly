from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.dashboard import DashboardSummaryResponse
from app.services.dashboard import get_dashboard_summary

router = APIRouter()


@router.get("/summary", response_model=DashboardSummaryResponse)
async def dashboard_summary(
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_dashboard_summary(db, context.account_id)
