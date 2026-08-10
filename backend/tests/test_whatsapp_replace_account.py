from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_replace_helpers_exist() -> None:
    source = read("app/services/whatsapp.py")
    assert "async def _get_whatsapp_account_for_channel" in source
    assert "async def _assert_phone_number_available" in source
    assert "async def _finalize_whatsapp_connection" in source


def test_manual_connect_updates_existing_channel_row() -> None:
    source = read("app/services/whatsapp.py")
    manual = source.split("async def create_whatsapp_account(")[1].split(
        "async def update_whatsapp_access_token("
    )[0]
    assert "channel_account = await _get_whatsapp_account_for_channel" in manual
    assert "if channel_account is not None:" in manual
    assert "whatsapp_account = channel_account" in manual
    assert "whatsapp_account.phone_number_id = payload.phone_number_id" in manual
    assert "except_account_id=channel_account.id if channel_account else None" in manual


def test_embedded_connect_updates_existing_channel_row() -> None:
    source = read("app/services/whatsapp.py")
    embedded = source.split("async def create_whatsapp_account_from_embedded(")[1].split(
        "async def list_whatsapp_accounts("
    )[0]
    assert "channel_account = await _get_whatsapp_account_for_channel" in embedded
    assert "if channel_account is not None:" in embedded
    assert "whatsapp_account = channel_account" in embedded
    assert "whatsapp_account.connection_method = WhatsAppConnectionMethod.EMBEDDED" in embedded
    assert "return await _finalize_whatsapp_connection(" in embedded


def test_finalize_updates_channel_external_id() -> None:
    source = read("app/services/whatsapp.py")
    finalize = source.split("async def _finalize_whatsapp_connection(")[1].split(
        "async def create_whatsapp_account("
    )[0]
    assert "channel.external_id = whatsapp_account.phone_number_id" in finalize
    assert "channel.status = ChannelStatus.ACTIVE" in finalize
    assert "ensure_waba_webhook_subscription" in finalize
