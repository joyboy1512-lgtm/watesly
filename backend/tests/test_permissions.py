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
