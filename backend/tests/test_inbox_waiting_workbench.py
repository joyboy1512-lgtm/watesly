from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_inbox_waiting_workbench_and_oldest_cta() -> None:
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert "فتح أقدم محادثة تنتظر الرد" in page
    assert "inbox-workbench-idle" in page
    assert "pickOldestWaitingConversation" in page
    assert "sortWaitingOldestFirst" in page
    assert "clearConversationSelection" in page
    assert "draftsByConversationRef" in page
    assert "composer-more" in page
    assert "المزيد" in page
    # Marketing price samples removed from live inbox idle state.
    assert "كم سعر الباقة؟" not in page
    assert "الباقة 25 د.ك" not in page
    assert "chat-idle-deal-card" not in page
    assert "chat-idle-samples" not in page


def test_waiting_duration_helper_supports_days() -> None:
    helpers = read("../frontend/src/lib/inboxHelpers.ts")
    assert "formatWaitingExactTime" in helpers
    assert "1440" in helpers
    assert "ي" in helpers


def test_needs_reply_list_orders_oldest_first() -> None:
    conversations = read("app/services/conversations.py")
    assert "needs_reply is True" in conversations
    assert "last_message_at.asc()" in conversations
