from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_worker_records_inbox_message_after_send() -> None:
    tasks = read("app/workers/campaign_tasks.py")
    campaigns = read("app/services/campaigns.py")
    assert "record_campaign_outbound_message" in tasks
    assert "publish_event" in tasks
    assert "async def record_campaign_outbound_message" in campaigns
    assert "async def backfill_campaign_inbox_messages" in campaigns


def test_inbox_websocket_refreshes_on_conversation_updates() -> None:
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    assert 'payload.type === "message.sent"' in inbox
    assert 'payload.type === "conversation.updated"' in inbox
