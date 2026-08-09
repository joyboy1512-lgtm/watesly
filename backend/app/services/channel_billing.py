from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.services.billing import get_active_subscription
from app.services.billing_limits import build_channel_billing_fields
from app.services.mac_tracking import (
    count_campaign_messages_for_channel,
    count_mac_for_channel,
    get_account_mac_summary,
)


async def channel_billing_payload(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel: Channel,
    summary: dict | None = None,
    cycle: str | None = None,
) -> dict:
    subscription_data = await get_active_subscription(db, account_id)
    subscription = subscription_data[0] if subscription_data else None
    plan = subscription_data[1] if subscription_data else None

    if summary is None:
        summary = await get_account_mac_summary(db, account_id=account_id, cycle_month=cycle)

    period_start = summary["billing_period_start"]
    period_end = summary["billing_period_end"]
    cycle_key = cycle or str(summary["cycle_month"])

    mac_count = await count_mac_for_channel(
        db,
        account_id=account_id,
        channel_id=channel.id,
        period_start=period_start,
    )
    workspace_mac = int(summary["mac_count"])
    workspace_over = int(summary["over_mac_count"])
    overage_enabled = bool(summary.get("overage_enabled", True))

    billing_fields = build_channel_billing_fields(
        channel=channel,
        channel_mac=mac_count,
        workspace_mac=workspace_mac,
        workspace_over_count=workspace_over,
        subscription=subscription,
        plan=plan,
        billing_period_start=period_start,
        billing_period_end=period_end,
        overage_enabled=overage_enabled,
    )
    return {
        "mac_count": mac_count,
        "cycle_month": cycle_key,
        **billing_fields,
    }
