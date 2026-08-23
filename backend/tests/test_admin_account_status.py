from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_admin_account_status_requires_confirm_to_block() -> None:
    routes = read("app/api/routes/admin.py")
    schemas = read("app/schemas/admin.py")
    admin = read("app/services/admin.py")
    frontend = read("../frontend/src/pages/SuperAdminPage.tsx")
    assert "ACCOUNT_SUSPEND_CONFIRM_REQUIRED" in routes
    assert "confirm: bool" in schemas
    assert "account_status_changed" in admin
    assert "confirm:" in frontend
    assert "window.confirm" in frontend
