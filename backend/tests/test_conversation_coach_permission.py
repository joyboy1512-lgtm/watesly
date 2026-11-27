from app.core.permissions import Permission, ROLE_PERMISSIONS, membership_has_permission
from app.models.membership import MembershipRole
from app.schemas.inbox_tools import NoteCreateRequest


def test_coach_permission_on_manager_not_agent() -> None:
    assert Permission.CONVERSATIONS_COACH in ROLE_PERMISSIONS[MembershipRole.MANAGER]
    assert Permission.CONVERSATIONS_COACH in ROLE_PERMISSIONS[MembershipRole.BRANCH_ADMIN]
    assert Permission.CONVERSATIONS_COACH in ROLE_PERMISSIONS[MembershipRole.OWNER]
    assert Permission.CONVERSATIONS_COACH not in ROLE_PERMISSIONS[MembershipRole.AGENT]
    assert Permission.CONVERSATIONS_COACH not in ROLE_PERMISSIONS[MembershipRole.VIEWER]


def test_note_create_accepts_whisper_kind() -> None:
    payload = NoteCreateRequest(body="وجّه العميل للعرض", kind="whisper")
    assert payload.kind == "whisper"


def test_whisper_route_wired() -> None:
    from pathlib import Path

    source = Path("app/api/routes/inbox_tools.py").read_text(encoding="utf-8")
    assert "/conversations/{conversation_id}/whispers" in source
    assert "CONVERSATIONS_COACH" in source
    assert 'kind == "whisper"' in source or "kind\": \"whisper\"" in source
