from app.core.permissions import Permission, role_has_permission
from app.models.membership import MembershipRole


def test_owner_has_every_permission() -> None:
    assert all(role_has_permission(MembershipRole.OWNER, item) for item in Permission)


def test_agent_cannot_approve_campaigns() -> None:
    assert not role_has_permission(MembershipRole.AGENT, Permission.CAMPAIGNS_APPROVE)
    assert role_has_permission(MembershipRole.AGENT, Permission.MESSAGES_SEND)


def test_agent_can_export_contacts_with_contacts_view() -> None:
    assert role_has_permission(MembershipRole.AGENT, Permission.CONTACTS_VIEW)
    assert not role_has_permission(MembershipRole.AGENT, Permission.REPORTS_EXPORT)


def test_branch_admin_has_branch_ops_without_billing_or_operations() -> None:
    assert role_has_permission(MembershipRole.BRANCH_ADMIN, Permission.CAMPAIGNS_CREATE)
    assert role_has_permission(MembershipRole.BRANCH_ADMIN, Permission.CAMPAIGNS_APPROVE)
    assert role_has_permission(MembershipRole.BRANCH_ADMIN, Permission.ORGANIZATIONS_MANAGE)
    assert not role_has_permission(MembershipRole.BRANCH_ADMIN, Permission.BILLING_VIEW)
    assert not role_has_permission(MembershipRole.BRANCH_ADMIN, Permission.OPERATIONS_VIEW)
