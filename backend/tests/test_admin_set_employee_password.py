from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_set_employee_password_service_exists() -> None:
    team = read("app/services/team.py")
    schema = read("app/schemas/team.py")
    routes = read("app/api/routes/team.py")

    assert "class SetEmployeePasswordRequest" in schema
    assert "async def set_employee_password" in team
    assert "revoke_all_user_sessions" in team
    assert "password_changed_at = now" in team
    assert '@router.post("/employees/{membership_id}/password"' in routes
    assert "set_employee_password(" in routes
    assert 'Permission.USERS_MANAGE' in routes


def test_owner_password_change_requires_owner_actor() -> None:
    team = read("app/services/team.py")
    assert "membership.role == MembershipRole.OWNER and actor_membership.role != MembershipRole.OWNER" in team
    assert 'raise ValueError("FORBIDDEN")' in team


def test_team_page_exposes_password_editor() -> None:
    page = read("../frontend/src/pages/TeamPage.tsx")
    assert "passwordEditor" in page
    assert "openPasswordEditor" in page
    assert "savePassword" in page
    assert "/password" in page
    assert "كلمة المرور" in page
    assert "canEditEmployeePassword" in page
