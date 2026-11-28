from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_blocked_inbox_scope_wired() -> None:
    service = read("app/services/conversations.py")
    routes = read("app/api/routes/conversations.py")
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert 'elif scope == "blocked":' in service
    assert "ConversationStatus.SPAM" in service
    assert "blocked" in routes
    assert '"blocked"' in page
    assert "محظورة" in page


def test_manual_handoff_note_on_reassign() -> None:
    service = read("app/services/conversations.py")
    assert "_write_manual_handoff_note" in service
    assert "[تسليم بين الموظفين]" in service


def test_csat_get_endpoint_and_panel() -> None:
    csat = read("app/services/csat.py")
    routes = read("app/api/routes/conversations.py")
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert "async def get_conversation_rating" in csat
    assert 'get("/{conversation_id}/csat")' in routes or "@router.get(\"/{conversation_id}/csat\")" in routes
    assert "conversation-csat" in page
    assert "آخر تقييم" in page


def test_attachments_hub_in_customer_panel() -> None:
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert "conversationAttachments" in page
    assert "<h4>المرفقات</h4>" in page
