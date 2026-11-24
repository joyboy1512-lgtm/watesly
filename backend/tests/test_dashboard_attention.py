from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_waiting_reply_definition_is_shared() -> None:
    attention = read("app/services/conversation_attention.py")
    assert "MessageDirection.INBOUND" in attention
    assert "ConversationStatus.OPEN" in attention
    assert "count_waiting_reply" in attention
    assert "Contact.deleted_at.is_(None)" in attention
    assert "waiting_reply_predicates" in attention

    conversations = read("app/services/conversations.py")
    assert "needs_reply: bool | None = None" in conversations
    assert "waiting_reply_predicates" in conversations
    assert "last_message_at.asc()" in conversations or "asc().nulls_last()" in conversations

    inbox_tools = read("app/services/inbox_tools.py")
    assert "count_waiting_reply" in inbox_tools

    dashboard_page = (ROOT.parent / "frontend/src/pages/DashboardPage.tsx").read_text(encoding="utf-8")
    assert "/dashboard/attention" in dashboard_page
    assert "صفر حقيقي" in dashboard_page
    assert "تعذّر التحميل" in dashboard_page

    inbox_page = (ROOT.parent / "frontend/src/pages/InboxPage.tsx").read_text(encoding="utf-8")
    assert 'params.needs_reply = true' in inbox_page
    assert 'next.set("needs_reply", "1")' in inbox_page


def test_dashboard_attention_endpoint_and_schema() -> None:
    routes = read("app/api/routes/dashboard.py")
    assert '/attention"' in routes or "/attention" in routes
    assert "CONVERSATIONS_VIEW" in routes
    assert "get_dashboard_attention" in routes
    assert "organization_id" in routes

    schema = read("app/schemas/dashboard.py")
    assert "DashboardAttentionResponse" in schema
    assert "waiting_reply_count" in schema
    assert "primary_action" in schema

    service = read("app/services/dashboard.py")
    assert "get_dashboard_attention" in service
    assert 'audience == "employee"' in service
    assert 'audience == "supervisor"' in service
    assert "_attention_inbox_href" in service
    assert "needs_reply=1" in service


def test_conversations_route_exposes_needs_reply_query() -> None:
    source = read("app/api/routes/conversations.py")
    assert "needs_reply: bool | None" in source
    assert "needs_reply=needs_reply" in source
