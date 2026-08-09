from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_start_conversation_endpoint_exists() -> None:
    routes = read("app/api/routes/conversations.py")
    management = read("app/services/contact_management.py")
    assert '"/start"' in routes or "'/start'" in routes
    assert "start_conversation_on_channel" in management
    assert "list_channel_threads_for_phone" in management


def test_contacts_are_scoped_per_channel() -> None:
    contact_model = read("app/models/contact.py")
    assert "uq_contacts_org_channel_address" in contact_model
    assert "channel_id" in contact_model
