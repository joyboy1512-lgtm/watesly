from app.services.plan_limits import UNLIMITED, is_unlimited, limit_reached, organization_limit_reached


def test_unlimited_organization_limit() -> None:
    assert UNLIMITED == 0
    assert is_unlimited(0) is True
    assert organization_limit_reached(current_count=9999, max_organizations=0) is False


def test_limit_reached_helpers() -> None:
    assert limit_reached(current_count=2, max_limit=2) is True
    assert limit_reached(current_count=1, max_limit=0) is False
