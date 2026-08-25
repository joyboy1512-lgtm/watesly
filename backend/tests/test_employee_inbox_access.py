from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_agents_see_all_accessible_conversations_not_only_assigned() -> None:
    service = read("app/services/conversations.py")
    assert "_limited_to_assigned_conversations" in service
    assert "MembershipRole.VIEWER" in service
    assert 'membership.role.value in {"agent", "viewer"}' not in service


def test_agent_role_has_messages_send_permission() -> None:
    permissions = read("app/core/permissions.py")
    assert "MembershipRole.AGENT: frozenset({" in permissions
    assert "Permission.MESSAGES_SEND" in permissions
