from app.services.plan_limits import UNLIMITED, is_unlimited, organization_limit_reached


def test_unlimited_organization_limit() -> None:
    assert UNLIMITED == 0
    assert is_unlimited(0) is True
    assert organization_limit_reached(current_count=9999, max_organizations=0) is False


def test_finite_organization_limit() -> None:
    assert organization_limit_reached(current_count=2, max_organizations=2) is True
    assert organization_limit_reached(current_count=1, max_organizations=2) is False
