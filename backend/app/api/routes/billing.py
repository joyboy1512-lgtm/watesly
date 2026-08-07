from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.api.routes.mac import router as mac_router
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.billing import SubscriptionResponse
from app.services.billing import get_active_subscription

router = APIRouter()
router.include_router(mac_router)


@router.get("/subscription", response_model=SubscriptionResponse)
async def current_subscription(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionResponse:
    data = await get_active_subscription(db, context.account_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No active subscription")
    subscription, plan = data
    return SubscriptionResponse(
        plan_id=plan.id,
        plan_code=plan.code,
        plan_name=plan.name,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        starts_at=subscription.starts_at,
        ends_at=subscription.ends_at,
        max_users=plan.max_users,
        max_organizations=plan.max_organizations,
        max_channels=plan.max_channels,
        allow_multi_organization=plan.allow_multi_organization,
    )
