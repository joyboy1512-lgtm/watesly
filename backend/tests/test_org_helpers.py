from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_organization_create_errors_are_structured() -> None:
    routes = read("app/api/routes/organizations.py")
    assert "MULTI_ORGANIZATION_NOT_ALLOWED" in routes
    assert "ORGANIZATION_SLUG_EXISTS" in routes


def test_trial_plan_allows_multiple_organizations() -> None:
    billing = read("app/services/billing.py")
    assert "max_organizations=5" in billing
    assert "allow_multi_organization=True" in billing
