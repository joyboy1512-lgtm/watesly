"""Effective MAC limits and per-channel Over MAC pricing (provider-configurable)."""
from __future__ import annotations

from app.models.channel import Channel
from app.models.plan import Plan
from app.models.subscription import Subscription

from app.services.mac_tracking import compute_mac_balance, estimate_over_mac_charge


def effective_included_mac(*, subscription: Subscription | None, plan: Plan | None) -> int:
    if subscription is not None and subscription.included_mac_override is not None:
        return int(subscription.included_mac_override)
    if plan is not None:
        return int(plan.included_mac)
    return 1000


def effective_workspace_over_price(
    *,
    subscription: Subscription | None,
    plan: Plan | None,
) -> float:
    if subscription is not None and subscription.over_mac_price_per_100_override is not None:
        return float(subscription.over_mac_price_per_100_override)
    if plan is not None:
        return float(plan.over_mac_price_per_100)
    return 12.0


def effective_channel_over_price(
    *,
    channel: Channel,
    subscription: Subscription | None,
    plan: Plan | None,
) -> float:
    if channel.over_mac_price_per_100 is not None:
        return float(channel.over_mac_price_per_100)
    return effective_workspace_over_price(subscription=subscription, plan=plan)


def compute_channel_over_mac_charge(
    *,
    channel_mac: int,
    workspace_mac: int,
    workspace_over_count: int,
    price_per_100: float,
    overage_enabled: bool = True,
) -> dict[str, int | float]:
    """Attribute workspace overage to a channel proportionally, priced per channel rate."""
    if (
        not overage_enabled
        or workspace_over_count <= 0
        or workspace_mac <= 0
        or channel_mac <= 0
    ):
        return {
            "attributed_over_mac_count": 0,
            "over_mac_blocks": 0,
            "estimated_channel_over_mac_charge": 0.0,
        }
    attributed = int(channel_mac * workspace_over_count / workspace_mac)
    if attributed <= 0:
        return {
            "attributed_over_mac_count": 0,
            "over_mac_blocks": 0,
            "estimated_channel_over_mac_charge": 0.0,
        }
    blocks = (attributed + 99) // 100
    charge = estimate_over_mac_charge(over_mac_count=attributed, price_per_100=price_per_100)
    return {
        "attributed_over_mac_count": attributed,
        "over_mac_blocks": blocks,
        "estimated_channel_over_mac_charge": charge,
    }


def build_channel_billing_fields(
    *,
    channel: Channel,
    channel_mac: int,
    workspace_mac: int,
    workspace_over_count: int,
    subscription: Subscription | None,
    plan: Plan | None,
    billing_period_start,
    billing_period_end,
    overage_enabled: bool,
) -> dict:
    price = effective_channel_over_price(
        channel=channel, subscription=subscription, plan=plan
    )
    over = compute_channel_over_mac_charge(
        channel_mac=channel_mac,
        workspace_mac=workspace_mac,
        workspace_over_count=workspace_over_count,
        price_per_100=price,
        overage_enabled=overage_enabled,
    )
    included = effective_included_mac(subscription=subscription, plan=plan)
    balance = compute_mac_balance(mac_count=workspace_mac, included_mac=included)
    return {
        "subscription_starts_at": subscription.starts_at if subscription else None,
        "subscription_ends_at": subscription.ends_at if subscription else None,
        "billing_period_start": billing_period_start,
        "billing_period_end": billing_period_end,
        "over_mac_price_per_100": price,
        "included_mac": included,
        "mac_remaining": int(balance["mac_remaining"]),
        "is_over_mac": bool(balance["is_over_mac"]),
        "over_mac_count": workspace_over_count,
        **over,
    }
