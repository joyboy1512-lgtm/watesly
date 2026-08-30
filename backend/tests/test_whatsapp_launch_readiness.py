from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_storage_builds_public_url() -> None:
    source = read("app/services/storage.py")
    assert "build_public_url" in source
    assert "resolve_accessible_url" in source
    assert "s3_public_base_url" in source


def test_storage_upload_returns_public_url() -> None:
    source = read("app/services/storage.py")
    assert "return key, self.resolve_accessible_url(key, for_meta=True)" in source


def test_whatsapp_media_service_exists() -> None:
    source = read("app/services/whatsapp_media.py")
    inbound = read("app/services/inbound_whatsapp.py")
    assert "store_inbound_whatsapp_media" in source
    assert "store_inbound_whatsapp_media" in inbound


def test_message_media_uses_object_key() -> None:
    source = read("app/services/message_media.py")
    assert "object_key" in source
    assert "resolve_accessible_url" in source


def test_token_update_endpoint_exists() -> None:
    routes = read("app/api/routes/whatsapp.py")
    assert "/access-token" in routes
    assert "/token-status" in routes
    assert "update_whatsapp_access_token" in routes


def test_whatsapp_health_marks_disconnected_on_auth_error() -> None:
    source = read("app/services/whatsapp_health.py")
    assert "WhatsAppAccountStatus.DISCONNECTED" in source
    assert "inspect_whatsapp_access_token" in source
