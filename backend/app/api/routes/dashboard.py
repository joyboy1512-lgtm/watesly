from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.dashboard import DashboardAttentionResponse, DashboardSummaryResponse
from app.services.dashboard import get_dashboard_attention, get_dashboard_summary

router = APIRouter()


@router.get("/summary", response_model=DashboardSummaryResponse)
async def dashboard_summary(
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_dashboard_summary(db, context.account_id)


@router.get("/attention", response_model=DashboardAttentionResponse)
async def dashboard_attention(
    organization_id: UUID | None = Query(None, description="Workspace branch filter"),
    channel_id: UUID | None = Query(None, description="Optional channel filter"),
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    """Role-aware attention board — available to agents (conversations.view)."""
    return await get_dashboard_attention(
        db,
        account_id=context.account_id,
        membership=context.membership,
        organization_id=organization_id,
        channel_id=channel_id,
    )
