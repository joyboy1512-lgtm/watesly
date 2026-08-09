from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.admin import require_super_admin
from app.api.dependencies.auth import AuthContext
from app.db.session import get_db
from app.schemas.admin import (
    AdminAccountResponse,
    AdminAccountUpdateRequest,
    AdminPlanCreateRequest,
    AdminPlanResponse,
    AdminPlanUpdateRequest,
    AdminSubscriptionResponse,
    AdminSubscriptionUpdateRequest,
)
from app.services.admin import (
    create_plan,
    list_accounts,
    list_plans,
    update_account_status,
    update_plan,
    update_subscription,
)

router = APIRouter()


@router.get("/accounts", response_model=list[AdminAccountResponse])
async def get_accounts(
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminAccountResponse]:
    rows = await list_accounts(db)
    return [
        AdminAccountResponse(
            id=account.id,
            name=account.name,
            status=account.status,
            created_at=account.created_at,
            plan_code=plan.code if plan else None,
            subscription_status=subscription.status if subscription else None,
        )
        for account, subscription, plan in rows
    ]


@router.patch("/accounts/{account_id}", response_model=AdminAccountResponse)
async def patch_account(
    account_id: UUID,
    payload: AdminAccountUpdateRequest,
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminAccountResponse:
    try:
        account = await update_account_status(db, account_id, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Account not found") from exc

    return AdminAccountResponse(
        id=account.id,
        name=account.name,
        status=account.status,
        created_at=account.created_at,
    )


@router.get("/plans", response_model=list[AdminPlanResponse])
async def get_plans(
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    return await list_plans(db)


@router.post("/plans", response_model=AdminPlanResponse, status_code=status.HTTP_201_CREATED)
async def post_plan(
    payload: AdminPlanCreateRequest,
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_plan(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Plan code already exists") from exc


@router.patch("/plans/{plan_id}", response_model=AdminPlanResponse)
async def patch_plan(
    plan_id: UUID,
    payload: AdminPlanUpdateRequest,
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_plan(db, plan_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Plan not found") from exc


@router.put("/accounts/{account_id}/subscription", response_model=AdminSubscriptionResponse)
async def put_subscription(
    account_id: UUID,
    payload: AdminSubscriptionUpdateRequest,
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminSubscriptionResponse:
    try:
        subscription, plan = await update_subscription(db, account_id, payload)
    except ValueError as exc:
        detail = "Account not found" if str(exc) == "ACCOUNT_NOT_FOUND" else "Plan not found"
        raise HTTPException(status_code=404, detail=detail) from exc

    return AdminSubscriptionResponse(
        id=subscription.id,
        account_id=subscription.account_id,
        plan_id=subscription.plan_id,
        plan_code=plan.code,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        starts_at=subscription.starts_at,
        ends_at=subscription.ends_at,
        included_mac_override=subscription.included_mac_override,
        over_mac_price_per_100_override=(
            float(subscription.over_mac_price_per_100_override)
            if subscription.over_mac_price_per_100_override is not None
            else None
        ),
    )
