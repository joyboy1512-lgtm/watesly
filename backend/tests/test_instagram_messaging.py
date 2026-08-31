from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_instagram_model_and_migration_exist() -> None:
    model = read("app/models/instagram_account.py")
    migration = read("alembic/versions/0062_instagram_accounts.py")
    assert "class InstagramAccount" in model
    assert "instagram_accounts" in migration
    assert revision_in(migration, "0062_instagram_accounts")


def revision_in(text: str, rev: str) -> bool:
    return f'revision = "{rev}"' in text


def test_instagram_routes_and_services() -> None:
    routes = read("app/api/routes/instagram.py")
    service = read("app/services/instagram.py")
    client = read("app/services/meta_instagram.py")
    router = read("app/api/router.py")
    assert 'prefix="/instagram"' in router
    assert "process_instagram_webhook" in routes
    assert "create_instagram_account" in service
    assert "send_instagram_text_message" in service
    assert "class MetaInstagramClient" in client
    assert "subscribe_page_webhooks" in client


def test_whatsapp_webhook_forwards_instagram_object() -> None:
    whatsapp = read("app/api/routes/whatsapp.py")
    assert 'payload.get("object") == "instagram"' in whatsapp
    assert "process_instagram_webhook" in whatsapp


def test_inbox_conversation_text_supports_instagram() -> None:
    conversations = read("app/api/routes/conversations.py")
    assert "ChannelType.INSTAGRAM" in conversations
    assert "send_instagram_text_message" in conversations


def test_frontend_instagram_connect_page() -> None:
    page = read("../frontend/src/pages/InstagramConnectPage.tsx")
    app = read("../frontend/src/App.tsx")
    channels = read("../frontend/src/pages/ChannelsPage.tsx")
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    assert "/instagram/accounts" in page
    assert 'path="/instagram-connect"' in app
    assert "/instagram-connect?channel=" in channels
    assert 'item.type === "instagram"' in inbox
