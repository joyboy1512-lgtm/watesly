"""Tests for MAC billing period and usage logic."""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.models.subscription import BillingCycle, Subscription, SubscriptionStatus
from app.services.billing_period import add_months, billing_period_for_subscription
from app.services.mac_tracking import compute_mac_balance, estimate_over_mac_charge
from app.services.mac_usage import MacActivityType, MAC_COUNTED_ACTIVITIES


def test_add_months_handles_month_end() -> None:
    start = datetime(2026, 1, 31, tzinfo=UTC)
    result = add_months(start, 1)
    assert result.month == 2
    assert result.day == 28


def test_billing_period_monthly_from_anchor() -> None:
    subscription = Subscription(
        account_id=uuid4(),
        plan_id=uuid4(),
        status=SubscriptionStatus.ACTIVE,
        billing_cycle=BillingCycle.MONTHLY,
        starts_at=datetime(2026, 8, 15, tzinfo=UTC),
        ends_at=datetime(2027, 8, 15, tzinfo=UTC),
    )
    period_start, period_end = billing_period_for_subscription(
        subscription, datetime(2026, 9, 10, tzinfo=UTC)
    )
    assert period_start == datetime(2026, 8, 15, tzinfo=UTC)
    assert period_end == datetime(2026, 9, 15, tzinfo=UTC)


def test_billing_period_trial_uses_full_window() -> None:
    subscription = Subscription(
        account_id=uuid4(),
        plan_id=uuid4(),
        status=SubscriptionStatus.TRIAL,
        billing_cycle=BillingCycle.TRIAL,
        starts_at=datetime(2026, 8, 1, tzinfo=UTC),
        ends_at=datetime(2026, 8, 15, tzinfo=UTC),
    )
    period_start, period_end = billing_period_for_subscription(
        subscription, datetime(2026, 8, 10, tzinfo=UTC)
    )
    assert period_start == subscription.starts_at
    assert period_end == subscription.ends_at


def test_broadcast_not_counted_in_mac_activities() -> None:
    assert MacActivityType.BROADCAST not in MAC_COUNTED_ACTIVITIES


def test_overage_blocks_round_up() -> None:
    balance = compute_mac_balance(mac_count=1001, included_mac=1000)
    assert balance["over_mac_count"] == 1
    assert balance["over_mac_blocks"] == 1
    assert estimate_over_mac_charge(over_mac_count=1, price_per_100=12.0) == 12.0

    balance2 = compute_mac_balance(mac_count=1201, included_mac=1000)
    assert balance2["over_mac_blocks"] == 3


def test_new_billing_period_resets_eligibility() -> None:
    """Same contact in a new period is a new MAC opportunity (logic-level)."""
    sub = Subscription(
        account_id=uuid4(),
        plan_id=uuid4(),
        status=SubscriptionStatus.ACTIVE,
        billing_cycle=BillingCycle.MONTHLY,
        starts_at=datetime(2026, 8, 1, tzinfo=UTC),
        ends_at=datetime(2027, 8, 1, tzinfo=UTC),
    )
    p1_start, p1_end = billing_period_for_subscription(sub, datetime(2026, 8, 20, tzinfo=UTC))
    p2_start, _ = billing_period_for_subscription(sub, p1_end + timedelta(seconds=1))
    assert p1_start != p2_start
