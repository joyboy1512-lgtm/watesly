from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.plan import Plan
from app.models.subscription import Subscription
from app.schemas.admin import (
    AdminPlanCreateRequest,
    AdminPlanUpdateRequest,
    AdminSubscriptionUpdateRequest,
)


async def list_accounts(db: AsyncSession) -> list[tuple[Account, Subscription | None, Plan | None]]:
    result = await db.execute(
        select(Account, Subscription, Plan)
        .outerjoin(Subscription, Subscription.account_id == Account.id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
        .order_by(Account.created_at.desc())
    )
    return list(result.all())


async def update_account_status(
    db: AsyncSession, account_id: UUID, status
) -> Account:
    account = await db.get(Account, account_id)
    if account is None:
        raise ValueError("ACCOUNT_NOT_FOUND")
    account.status = status
    await db.commit()
    await db.refresh(account)
    return account


async def list_plans(db: AsyncSession) -> list[Plan]:
    result = await db.execute(select(Plan).order_by(Plan.monthly_price.asc()))
    return list(result.scalars().all())


async def create_plan(db: AsyncSession, payload: AdminPlanCreateRequest) -> Plan:
    existing = await db.execute(select(Plan).where(Plan.code == payload.code))
    if existing.scalar_one_or_none() is not None:
        raise ValueError("PLAN_CODE_EXISTS")
    plan = Plan(**payload.model_dump())
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


async def update_plan(
    db: AsyncSession, plan_id: UUID, payload: AdminPlanUpdateRequest
) -> Plan:
    plan = await db.get(Plan, plan_id)
    if plan is None:
        raise ValueError("PLAN_NOT_FOUND")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(plan, key, value)
    await db.commit()
    await db.refresh(plan)
    return plan


async def update_subscription(
    db: AsyncSession,
    account_id: UUID,
    payload: AdminSubscriptionUpdateRequest,
) -> tuple[Subscription, Plan]:
    account = await db.get(Account, account_id)
    if account is None:
        raise ValueError("ACCOUNT_NOT_FOUND")
    plan = await db.get(Plan, payload.plan_id)
    if plan is None:
        raise ValueError("PLAN_NOT_FOUND")

    result = await db.execute(
        select(Subscription).where(Subscription.account_id == account_id)
    )
    subscription = result.scalar_one_or_none()
    if subscription is None:
        subscription = Subscription(
            account_id=account_id,
            plan_id=plan.id,
            status=payload.status,
            billing_cycle=payload.billing_cycle,
            starts_at=payload.starts_at or datetime.now(UTC),
            ends_at=payload.ends_at,
            included_mac_override=payload.included_mac_override,
            over_mac_price_per_100_override=payload.over_mac_price_per_100_override,
        )
        db.add(subscription)
    else:
        subscription.plan_id = plan.id
        subscription.status = payload.status
        subscription.billing_cycle = payload.billing_cycle
        if payload.starts_at is not None:
            subscription.starts_at = payload.starts_at
        subscription.ends_at = payload.ends_at
        if payload.included_mac_override is not None:
            subscription.included_mac_override = payload.included_mac_override
        if payload.over_mac_price_per_100_override is not None:
            subscription.over_mac_price_per_100_override = payload.over_mac_price_per_100_override

    await db.commit()
    await db.refresh(subscription)
    return subscription, plan
