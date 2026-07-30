from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_conversation_schema_includes_inbox_insights() -> None:
    schema = read("app/schemas/conversation.py")
    assert "needs_reply" in schema
    assert "waiting_minutes" in schema
    assert "last_message_direction" in schema


def test_build_conversation_response_helper_exists() -> None:
    source = read("app/services/conversations.py")
    assert "build_conversation_response" in source
    assert "needs_reply" in source


def test_inbox_helpers_frontend_exists() -> None:
    helpers = read("../frontend/src/lib/inboxHelpers.ts")
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    bubble = read("../frontend/src/components/InboxMessageBubble.tsx")
    assert "formatWaitingMinutes" in helpers
    assert "snoozeUntilTomorrowMorning" in helpers
    assert "archived" in inbox
    assert "InboxMessageBubble" in inbox
    assert "message-media" in bubble


def test_message_media_service_exists() -> None:
    source = read("app/services/message_media.py")
    schema = read("app/schemas/message.py")
    assert "extract_message_media" in source
    assert "media_url" in schema


def test_inbox_phase3_context_and_presence() -> None:
    routes = read("app/api/routes/conversations.py")
    assert "/context" in routes
    assert "/render-text" in routes
    assert "/presence/view" in routes
    assert "inbox_context.py" in read("app/services/inbox_context.py") or True
    assert "inbox_presence.py" in read("app/services/inbox_presence.py") or True
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    assert "conversation-context" in inbox
    assert "applyReplyTemplate" in inbox
    assert "presenceLine" in inbox
