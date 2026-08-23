from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan import Plan, PlanStatus
from app.models.subscription import BillingCycle, Subscription, SubscriptionStatus
from app.services.plan_limits import UNLIMITED


async def get_or_create_trial_plan(db: AsyncSession) -> Plan:
    result = await db.execute(select(Plan).where(Plan.code == "trial"))
    plan = result.scalar_one_or_none()
    if plan is not None:
        return plan

    plan = Plan(
        code="trial",
        name="Free Trial",
        monthly_price=0,
        yearly_price=0,
        max_users=3,
        max_organizations=UNLIMITED,
        max_channels=UNLIMITED,
        included_mac=100,
        over_mac_price_per_100=12,
        trial_days=14,
        allow_multi_organization=True,
    )
    db.add(plan)
    await db.flush()
    return plan


async def create_trial_subscription(db: AsyncSession, *, account_id: UUID) -> Subscription:
    plan = await get_or_create_trial_plan(db)
    now = datetime.now(UTC)
    subscription = Subscription(
        account_id=account_id,
        plan_id=plan.id,
        status=SubscriptionStatus.TRIAL,
        billing_cycle=BillingCycle.TRIAL,
        starts_at=now,
        ends_at=now + timedelta(days=plan.trial_days),
    )
    db.add(subscription)
    await db.flush()
    return subscription


async def get_active_subscription(db: AsyncSession, account_id: UUID) -> tuple[Subscription, Plan] | None:
    result = await db.execute(
        select(Subscription, Plan)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.account_id == account_id)
    )
    row = result.one_or_none()
    if row is None:
        return None
    subscription, plan = row
    if subscription.ends_at <= datetime.now(UTC):
        return None
    return subscription, plan


async def list_public_plans(db: AsyncSession) -> list[Plan]:
    result = await db.execute(
        select(Plan)
        .where(Plan.status == PlanStatus.ACTIVE, Plan.code != "trial")
        .order_by(Plan.monthly_price.asc(), Plan.name.asc())
    )
    return list(result.scalars().all())
