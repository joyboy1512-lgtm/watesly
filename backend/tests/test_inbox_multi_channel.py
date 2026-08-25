from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_conversation_list_supports_channel_filter() -> None:
    service = read("app/services/conversations.py")
    routes = read("app/api/routes/conversations.py")
    assert "channel_id: UUID | None = None" in service
    assert "ensure_conversation_channel_access" in service
    assert "channel_id: UUID | None = Query(None)" in routes
    assert "_LIST_LIMIT_MAX = 5000" in service
    assert "Query(5000, ge=1, le=5000)" in routes


def test_inbox_page_requests_full_conversation_limit() -> None:
    page = read("../frontend/src/pages/InboxPage.tsx")
    helpers = read("../frontend/src/lib/inboxHelpers.ts")
    assert "INBOX_CONVERSATIONS_LIMIT = 5000" in helpers
    assert "limit: INBOX_CONVERSATIONS_LIMIT" in page


def test_contact_phone_normalization_on_create_and_inbound() -> None:
    contacts = read("app/services/contacts.py")
    inbound = read("app/services/inbound_whatsapp.py")
    management = read("app/services/contact_management.py")
    normalize = read("app/services/phone_normalize.py")

    assert "find_contact_on_channel_by_phone" in contacts
    assert "normalize_whatsapp_phone" in contacts
    assert "phones_match" in normalize
    assert "find_contact_on_channel_by_phone" in inbound
    assert "phones_match" in management


def test_inbox_page_uses_server_channel_filter_and_phone_match() -> None:
    page = read("../frontend/src/pages/InboxPage.tsx")
    helpers = read("../frontend/src/lib/inboxHelpers.ts")

    assert 'params.channel_id = channelFilter' in page
    assert "phonesMatch" in page
    assert "/conversations/channel-threads" in page
    assert "whatsapp_account_id === selectedChannelAccountId" in page
    assert "export function normalizeWhatsAppPhone" in helpers
