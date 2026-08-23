from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_organization_create_has_branch_limits() -> None:
    org_model = read("app/models/organization.py")
    org_service = read("app/services/organizations.py")
    routes = read("app/api/routes/organizations.py")
    schema = read("app/schemas/organization.py")
    assert "max_users" in org_model
    assert "branch_admin_email" in routes
    assert "branch_admin_email" in schema
    assert "create_invitation" in routes
    assert "count_organization_members" in org_service
    assert "update_organization" in org_service
    assert "OrganizationUpdateRequest" in schema
    assert 'patch("/{organization_id}"' in routes or "@router.patch" in routes


def test_suspended_organization_blocks_access() -> None:
    access = read("app/services/membership_access.py")
    assert "ORGANIZATION_SUSPENDED" in access
    assert "resolve_active_organization_ids" in access
