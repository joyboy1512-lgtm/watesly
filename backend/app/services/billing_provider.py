"""Provider billing settings read/update for account and channels."""
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.plan import Plan
from app.models.subscription import Subscription
from app.schemas.billing import BillingProviderSettingsUpdate
from app.services.billing import get_active_subscription
from app.services.billing_limits import (
    effective_included_mac,
    effective_workspace_over_price,
)
from app.services.mac_tracking import get_account_mac_summary


async def get_provider_billing_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> dict:
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is None:
        raise ValueError("NO_ACTIVE_SUBSCRIPTION")
    subscription, plan = subscription_data
    summary = await get_account_mac_summary(db, account_id=account_id)
    return {
        "starts_at": subscription.starts_at,
        "ends_at": subscription.ends_at,
        "billing_cycle": subscription.billing_cycle.value
        if hasattr(subscription.billing_cycle, "value")
        else str(subscription.billing_cycle),
        "billing_period_start": summary["billing_period_start"],
        "billing_period_end": summary["billing_period_end"],
        "included_mac": int(summary["included_mac"]),
        "included_mac_override": subscription.included_mac_override,
        "over_mac_price_per_100": float(summary["over_mac_price_per_100"]),
        "over_mac_price_per_100_override": (
            float(subscription.over_mac_price_per_100_override)
            if subscription.over_mac_price_per_100_override is not None
            else None
        ),
        "plan_name": plan.name,
        "plan_included_mac": int(plan.included_mac),
        "plan_over_mac_price_per_100": float(plan.over_mac_price_per_100),
    }


async def update_provider_billing_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: BillingProviderSettingsUpdate,
) -> dict:
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is None:
        raise ValueError("NO_ACTIVE_SUBSCRIPTION")
    subscription, _plan = subscription_data

    data = payload.model_dump(exclude_unset=True)
    if "starts_at" in data and data["starts_at"] is not None:
        subscription.starts_at = data["starts_at"]
    if "ends_at" in data and data["ends_at"] is not None:
        subscription.ends_at = data["ends_at"]
    if "included_mac_override" in data:
        subscription.included_mac_override = data["included_mac_override"]
    if "over_mac_price_per_100_override" in data:
        subscription.over_mac_price_per_100_override = data["over_mac_price_per_100_override"]

    await db.commit()
    await db.refresh(subscription)
    return await get_provider_billing_settings(db, account_id=account_id)


async def update_channel_billing_price(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    over_mac_price_per_100: float | None,
) -> Channel:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("CHANNEL_NOT_FOUND")
    channel.over_mac_price_per_100 = over_mac_price_per_100
    await db.commit()
    await db.refresh(channel)
    return channel
