"""Billing period resolution from subscription anchor (not calendar month)."""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import BillingCycle, Subscription


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_month = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        next_month = datetime(year, month + 1, 1, tzinfo=UTC)
    start = datetime(year, month, 1, tzinfo=UTC)
    return (next_month - start).days


def add_months(dt: datetime, months: int) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    month_index = dt.month - 1 + months
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    day = min(dt.day, _days_in_month(year, month))
    return dt.replace(year=year, month=month, day=day, tzinfo=UTC)


def billing_period_for_subscription(
    subscription: Subscription,
    reference: datetime | None = None,
) -> tuple[datetime, datetime]:
    """Return (start, end) for the billing period containing reference."""
    ref = reference or datetime.now(UTC)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=UTC)

    if subscription.billing_cycle == BillingCycle.TRIAL:
        return subscription.starts_at, subscription.ends_at

    step_months = 12 if subscription.billing_cycle == BillingCycle.YEARLY else 1
    anchor = subscription.starts_at
    if ref.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC) if anchor.tzinfo is None else anchor

    period_start = anchor
    while period_start < subscription.ends_at:
        period_end = add_months(period_start, step_months)
        if period_end > subscription.ends_at:
            period_end = subscription.ends_at
        if ref < period_end or period_end >= subscription.ends_at:
            return period_start, period_end
        period_start = period_end

    return subscription.starts_at, subscription.ends_at


def cycle_month_key(period_start: datetime) -> str:
    """Legacy cycle_month key derived from billing period start."""
    return period_start.strftime("%Y-%m")


async def resolve_billing_period(
    db: AsyncSession,
    *,
    account_id: UUID,
    reference: datetime | None = None,
) -> tuple[datetime, datetime] | None:
    from app.services.billing import get_active_subscription

    data = await get_active_subscription(db, account_id)
    if data is None:
        ref = reference or datetime.now(UTC)
        start = datetime(ref.year, ref.month, 1, tzinfo=UTC)
        end = add_months(start, 1)
        return start, end
    subscription, _plan = data
    return billing_period_for_subscription(subscription, reference)
