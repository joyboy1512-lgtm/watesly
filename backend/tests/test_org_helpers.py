from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_organization_create_has_no_multi_org_gate() -> None:
    orgs = read("app/services/organizations.py")
    billing = read("app/services/billing.py")
    assert "MULTI_ORGANIZATION_NOT_ALLOWED" not in orgs
    assert "max_organizations=UNLIMITED" in billing or "max_organizations=0" in billing
