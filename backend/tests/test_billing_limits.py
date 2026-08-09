"""Tests for per-channel MAC billing limits."""
from datetime import UTC, datetime
from uuid import uuid4

from app.models.channel import Channel, ChannelStatus, ChannelType
from app.models.plan import Plan
from app.models.subscription import BillingCycle, Subscription, SubscriptionStatus
from app.services.billing_limits import (
    compute_channel_over_mac_charge,
    effective_channel_included_mac,
    effective_channel_over_price,
)


def _channel(**kwargs) -> Channel:
    defaults = {
        "id": uuid4(),
        "account_id": uuid4(),
        "organization_id": uuid4(),
        "type": ChannelType.WHATSAPP,
        "name": "Test",
        "status": ChannelStatus.ACTIVE,
    }
    defaults.update(kwargs)
    return Channel(**defaults)


def _subscription(**kwargs) -> Subscription:
    defaults = {
        "account_id": uuid4(),
        "plan_id": uuid4(),
        "status": SubscriptionStatus.ACTIVE,
        "billing_cycle": BillingCycle.MONTHLY,
        "starts_at": datetime(2026, 8, 1, tzinfo=UTC),
        "ends_at": datetime(2027, 8, 1, tzinfo=UTC),
    }
    defaults.update(kwargs)
    return Subscription(**defaults)


def _plan(**kwargs) -> Plan:
    defaults = {
        "id": uuid4(),
        "code": "growth",
        "name": "Growth",
        "included_mac": 1000,
        "over_mac_price_per_100": 12.0,
    }
    defaults.update(kwargs)
    return Plan(**defaults)


def test_effective_channel_included_mac_prefers_channel_override() -> None:
    channel = _channel(included_mac=500)
    sub = _subscription(included_mac_override=800)
    plan = _plan(included_mac=1000)
    assert effective_channel_included_mac(channel=channel, subscription=sub, plan=plan) == 500


def test_effective_channel_over_price_prefers_channel_override() -> None:
    channel = _channel(over_mac_price_per_100=9.5)
    sub = _subscription(over_mac_price_per_100_override=11.0)
    plan = _plan(over_mac_price_per_100=12.0)
    assert effective_channel_over_price(channel=channel, subscription=sub, plan=plan) == 9.5


def test_independent_channel_overage_not_proportional() -> None:
    result = compute_channel_over_mac_charge(
        channel_mac=1100,
        included_mac=1000,
        price_per_100=12.0,
        overage_enabled=True,
    )
    assert result["attributed_over_mac_count"] == 100
    assert result["over_mac_blocks"] == 1
    assert result["estimated_channel_over_mac_charge"] == 12.0


def test_same_contact_two_channels_counts_twice_at_account_level() -> None:
    """Logic-level: two channels each over by 50 MAC bill independently."""
    ch1 = compute_channel_over_mac_charge(
        channel_mac=1050, included_mac=1000, price_per_100=10.0
    )
    ch2 = compute_channel_over_mac_charge(
        channel_mac=1050, included_mac=1000, price_per_100=10.0
    )
    total_over = int(ch1["attributed_over_mac_count"]) + int(ch2["attributed_over_mac_count"])
    total_charge = float(ch1["estimated_channel_over_mac_charge"]) + float(
        ch2["estimated_channel_over_mac_charge"]
    )
    assert total_over == 100
    assert total_charge == 20.0
