from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_meta_client_can_unsubscribe_waba() -> None:
    client = read("app/services/meta_client.py")
    assert "async def unsubscribe_waba_webhooks" in client
    assert "client.delete(waba_url" in client


def test_meta_setup_maybe_unsubscribe() -> None:
    setup = read("app/services/meta_setup.py")
    assert "async def unsubscribe_waba_webhook_subscription" in setup
    assert "async def maybe_unsubscribe_whatsapp_account_webhook" in setup
    assert 'reason": "other_active_on_waba"' in setup


def test_disconnect_whatsapp_account_tears_down_webhook() -> None:
    service = read("app/services/whatsapp.py")
    routes = read("app/api/routes/whatsapp.py")
    channels = read("app/services/channels.py")

    assert "async def disconnect_whatsapp_account" in service
    assert "maybe_unsubscribe_whatsapp_account_webhook" in service
    assert "channel.status = ChannelStatus.DISCONNECTED" in service
    assert "disconnect_whatsapp_account(" in routes
    assert "maybe_unsubscribe_whatsapp_account_webhook" in channels


def test_inbound_ignores_disconnected_whatsapp_accounts() -> None:
    service = read("app/services/whatsapp.py")
    webhook = service.split("async def store_and_process_webhook(")[1].split(
        "async def "
    )[0]
    assert "WhatsAppAccountStatus.ACTIVE" in webhook
    assert "account_active" in webhook
    assert "if account_active and event_type == \"message\":" in webhook


def test_frontend_disconnect_warns_about_meta() -> None:
    page = read("../frontend/src/pages/WhatsAppConnectPage.tsx")
    assert "window.confirm" in page
    assert "لن تُستلم رسائله هنا بعد الفصل" in page
    assert "/whatsapp/accounts/${accountId}/disconnect" in page
