"""Billing period resolution from subscription or channel anchor."""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
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


def _parse_billing_cycle(value: BillingCycle | str) -> BillingCycle:
    if isinstance(value, BillingCycle):
        return value
    try:
        return BillingCycle(str(value))
    except ValueError:
        return BillingCycle.MONTHLY


def billing_period_for_anchor(
    *,
    starts_at: datetime,
    ends_at: datetime,
    billing_cycle: BillingCycle | str,
    reference: datetime | None = None,
) -> tuple[datetime, datetime]:
    """Return (start, end) for the billing period containing reference."""
    ref = reference or datetime.now(UTC)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=UTC)

    cycle = _parse_billing_cycle(billing_cycle)
    if cycle == BillingCycle.TRIAL:
        return starts_at, ends_at

    step_months = 12 if cycle == BillingCycle.YEARLY else 1
    anchor = starts_at if starts_at.tzinfo else starts_at.replace(tzinfo=UTC)

    period_start = anchor
    while period_start < ends_at:
        period_end = add_months(period_start, step_months)
        if period_end > ends_at:
            period_end = ends_at
        if ref < period_end or period_end >= ends_at:
            return period_start, period_end
        period_start = period_end

    return starts_at, ends_at


def billing_period_for_subscription(
    subscription: Subscription,
    reference: datetime | None = None,
) -> tuple[datetime, datetime]:
    return billing_period_for_anchor(
        starts_at=subscription.starts_at,
        ends_at=subscription.ends_at,
        billing_cycle=subscription.billing_cycle,
        reference=reference,
    )


def cycle_month_key(period_start: datetime) -> str:
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


async def resolve_channel_billing_period(
    db: AsyncSession,
    *,
    channel_id: UUID,
    reference: datetime | None = None,
) -> tuple[datetime, datetime] | None:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.deleted_at is not None:
        return None

    if channel.billing_starts_at and channel.billing_ends_at:
        return billing_period_for_anchor(
            starts_at=channel.billing_starts_at,
            ends_at=channel.billing_ends_at,
            billing_cycle=channel.billing_cycle,
            reference=reference,
        )

    return await resolve_billing_period(
        db, account_id=channel.account_id, reference=reference
    )
