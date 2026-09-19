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


def test_start_conversation_reactivates_archived_and_requires_whatsapp() -> None:
    management = read("app/services/contact_management.py")
    routes = read("app/api/routes/conversations.py")
    page = read("../frontend/src/pages/InboxPage.tsx")
    helpers = read("../frontend/src/lib/inboxHelpers.ts")

    assert "reactivate" in management
    assert "conversation.archived_at = None" in management
    assert "CHANNEL_NOT_WHATSAPP" in management
    assert "CHANNEL_NOT_WHATSAPP" in routes
    assert "whatsappChannelOptions" in page
    assert "formatApiError" in page
    assert "skipGlobalErrorToast: true" in helpers


def test_start_conversation_imports_channel_access() -> None:
    routes = read("app/api/routes/conversations.py")
    management = read("app/services/contact_management.py")
    assert "ensure_conversation_channel_access" in routes
    assert "from app.services.conversations import" in routes
    assert "normalize_whatsapp_phone" in management
    # Ensure the access helper is imported for /start, not only referenced.
    import_block = routes.split("from app.services.conversations import", 1)[1].split(")", 1)[0]
    assert "ensure_conversation_channel_access" in import_block


def test_quick_reply_suggest_uses_keyword_account_id() -> None:
    routes = read("app/api/routes/inbox_tools.py")
    assert "account_id=context.account_id" in routes
