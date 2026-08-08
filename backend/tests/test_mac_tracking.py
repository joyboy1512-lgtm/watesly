from datetime import UTC, datetime

from app.services.mac_tracking import (
    compute_mac_balance,
    current_cycle_month,
    estimate_over_mac_charge,
)


def test_current_cycle_month_uses_utc_calendar_month() -> None:
    assert current_cycle_month(datetime(2026, 3, 15, tzinfo=UTC)) == "2026-03"


def test_compute_mac_balance_within_plan() -> None:
    balance = compute_mac_balance(mac_count=3420, included_mac=5000)
    assert balance["mac_remaining"] == 1580
    assert balance["is_over_mac"] is False
    assert balance["over_mac_count"] == 0


def test_compute_mac_balance_over_plan() -> None:
    balance = compute_mac_balance(mac_count=5125, included_mac=5000)
    assert balance["is_over_mac"] is True
    assert balance["over_mac_count"] == 125
    assert balance["over_mac_blocks"] == 2


def test_estimate_over_mac_charge_blocks_of_100() -> None:
    charge = estimate_over_mac_charge(over_mac_count=125, price_per_100=12.0)
    assert charge == 24.0

    zero = estimate_over_mac_charge(over_mac_count=0, price_per_100=12.0)
    assert zero == 0.0
