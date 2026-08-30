from pathlib import Path

from app.core.permissions import Permission, ROLE_PERMISSIONS
from app.models.campaign import CampaignStatus
from app.models.membership import MembershipRole


def test_business_routes_use_permission_dependencies() -> None:
    routes = Path("app/api/routes")
    exempt = {"auth.py", "admin.py", "health.py", "realtime.py", "notifications.py"}
    violations = []
    for path in routes.glob("*.py"):
        if path.name in exempt:
            continue
        source = path.read_text(encoding="utf-8")
        # Legacy role gates are forbidden; get_auth_context is allowed for
        # membership-scoped reads that enforce access in-service.
        if "require_roles(" in source:
            violations.append(path.name)
    assert violations == []


def test_permission_catalog_covers_production_domains() -> None:
    required = {
        Permission.CHANNELS_MANAGE,
        Permission.TEMPLATES_MANAGE,
        Permission.CAMPAIGNS_APPROVE,
        Permission.AUTOMATIONS_PUBLISH,
        Permission.ORGANIZATIONS_MANAGE,
        Permission.TRUST_MANAGE,
    }
    assert required.issubset(ROLE_PERMISSIONS[MembershipRole.OWNER])
    assert Permission.BILLING_MANAGE not in ROLE_PERMISSIONS[MembershipRole.MANAGER]


def test_campaign_has_safe_terminal_and_pause_states() -> None:
    assert CampaignStatus.PAUSED.value == "paused"
    assert CampaignStatus.COMPLETED_WITH_ERRORS.value == "completed_with_errors"


def test_automation_worker_enforces_runtime_guards() -> None:
    source = Path("app/workers/automation_tasks.py").read_text(encoding="utf-8")
    for field in ("cancellation_requested_at", "deadline_at", "max_steps", "step_count"):
        assert field in source


def test_super_admin_requires_support_grant_for_tenant_permissions() -> None:
    source = Path("app/api/dependencies/auth.py").read_text(encoding="utf-8")
    assert "SUPPORT_ACCESS_REQUIRED" in source
    assert "SupportAccessGrant.support_user_id == user_id" in source
