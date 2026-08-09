from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.services.billing import get_active_subscription
from app.services.billing_limits import build_channel_billing_fields
from app.services.billing_period import resolve_channel_billing_period
from app.services.mac_tracking import count_mac_for_channel


async def channel_billing_payload(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel: Channel,
    overage_enabled: bool = True,
) -> dict:
    subscription_data = await get_active_subscription(db, account_id)
    subscription = subscription_data[0] if subscription_data else None
    plan = subscription_data[1] if subscription_data else None

    period = await resolve_channel_billing_period(db, channel_id=channel.id)
    if period is None:
        period_start, period_end = None, None
    else:
        period_start, period_end = period

    mac_count = 0
    if period_start is not None:
        mac_count = await count_mac_for_channel(
            db,
            account_id=account_id,
            channel_id=channel.id,
            period_start=period_start,
        )

    billing_fields = build_channel_billing_fields(
        channel=channel,
        channel_mac=mac_count,
        subscription=subscription,
        plan=plan,
        billing_period_start=period_start,
        billing_period_end=period_end,
        overage_enabled=overage_enabled,
    )
    cycle_key = (
        period_start.strftime("%Y-%m") if period_start is not None else ""
    )
    return {
        "mac_count": mac_count,
        "cycle_month": cycle_key,
        **billing_fields,
    }
