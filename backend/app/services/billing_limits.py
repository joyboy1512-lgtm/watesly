"""Effective MAC limits and independent per-channel Over MAC billing."""
from __future__ import annotations

from app.models.channel import Channel
from app.models.plan import Plan
from app.models.subscription import Subscription

from app.services.mac_tracking import compute_mac_balance, estimate_over_mac_charge


def effective_channel_included_mac(
    *,
    channel: Channel,
    subscription: Subscription | None,
    plan: Plan | None,
) -> int:
    if channel.included_mac is not None:
        return int(channel.included_mac)
    if subscription is not None and subscription.included_mac_override is not None:
        return int(subscription.included_mac_override)
    if plan is not None:
        return int(plan.included_mac)
    return 1000


def effective_included_mac(*, subscription: Subscription | None, plan: Plan | None) -> int:
    """Legacy workspace default — used when seeding new channels."""
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
    included_mac: int,
    price_per_100: float,
    overage_enabled: bool = True,
) -> dict[str, int | float]:
    """Independent channel overage — not proportional to workspace."""
    balance = compute_mac_balance(mac_count=channel_mac, included_mac=included_mac)
    over_count = int(balance["over_mac_count"])
    if not overage_enabled or over_count <= 0:
        return {
            "attributed_over_mac_count": 0,
            "over_mac_blocks": 0,
            "estimated_channel_over_mac_charge": 0.0,
        }
    charge = estimate_over_mac_charge(over_mac_count=over_count, price_per_100=price_per_100)
    return {
        "attributed_over_mac_count": over_count,
        "over_mac_blocks": int(balance["over_mac_blocks"]),
        "estimated_channel_over_mac_charge": charge,
    }


def build_channel_billing_fields(
    *,
    channel: Channel,
    channel_mac: int,
    subscription: Subscription | None,
    plan: Plan | None,
    billing_period_start,
    billing_period_end,
    overage_enabled: bool,
) -> dict:
    included = effective_channel_included_mac(
        channel=channel, subscription=subscription, plan=plan
    )
    price = effective_channel_over_price(
        channel=channel, subscription=subscription, plan=plan
    )
    balance = compute_mac_balance(mac_count=channel_mac, included_mac=included)
    over_count = int(balance["over_mac_count"])
    over = compute_channel_over_mac_charge(
        channel_mac=channel_mac,
        included_mac=included,
        price_per_100=price,
        overage_enabled=overage_enabled,
    )
    return {
        "subscription_starts_at": channel.billing_starts_at
        or (subscription.starts_at if subscription else None),
        "subscription_ends_at": channel.billing_ends_at
        or (subscription.ends_at if subscription else None),
        "billing_period_start": billing_period_start,
        "billing_period_end": billing_period_end,
        "over_mac_price_per_100": price,
        "included_mac": included,
        "mac_remaining": int(balance["mac_remaining"]),
        "is_over_mac": bool(balance["is_over_mac"]),
        "over_mac_count": over_count,
        **over,
    }
