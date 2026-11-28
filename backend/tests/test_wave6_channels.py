from pathlib import Path

from app.services.channel_adapters import ADAPTERS, get_adapter
from app.services.contact_merge import _digits_only, _looks_like_phone
from app.services.feature_flags import DEFAULT_FLAGS


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_messenger_and_web_chat_adapters_ready() -> None:
    assert get_adapter("messenger") is not None
    assert get_adapter("web_chat") is not None
    assert "messenger" in ADAPTERS
    assert "web_chat" in ADAPTERS
    assert DEFAULT_FLAGS["messenger_channel"] is True


def test_messenger_service_and_routes_wired() -> None:
    model = read("app/models/messenger_account.py")
    service = read("app/services/messenger.py")
    routes = read("app/api/routes/messenger.py")
    router = read("app/api/router.py")
    assert "class MessengerAccount" in model
    assert "async def process_messenger_webhook" in service
    assert "async def send_messenger_text_message" in service
    assert 'prefix="/messenger"' in router or "messenger_router" in router
    assert "create_messenger_account" in routes


def test_web_chat_public_ingest_wired() -> None:
    service = read("app/services/web_chat.py")
    routes = read("app/api/routes/web_chat.py")
    assert "ingest_web_chat_inbound" in service
    assert "activate_web_chat_channel" in service
    assert "post_public_web_chat_message" in routes
    assert "widget_token" in routes


def test_inbox_send_supports_messenger_and_web_chat() -> None:
    conversations = read("app/api/routes/conversations.py")
    assert "ChannelType.MESSENGER" in conversations
    assert "ChannelType.WEB_CHAT" in conversations
    assert "send_messenger_text_message" in conversations
    assert "send_web_chat_text_message" in conversations


def test_cross_channel_phone_normalize_helpers() -> None:
    assert _looks_like_phone("+96550001111") is True
    assert _digits_only("+965-5000-1111") == "96550001111"
    merge = read("app/services/contact_merge.py")
    assert "same_phone_normalized" in merge
    assert "cross_channel" in merge


def test_frontend_messenger_connect_and_badges() -> None:
    app = read("../frontend/src/App.tsx")
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    channels = read("../frontend/src/pages/ChannelsPage.tsx")
    assert "MessengerConnectPage" in app
    assert "/messenger-connect" in app
    assert "messenger-accounts" in inbox
    assert "CHANNEL_TYPE_SHORT" in inbox
    assert "inbox-channel-badge" in inbox
    assert "messenger-connect" in channels
    assert "web-chat/channels" in channels
