from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_public_api_base_url_in_settings() -> None:
    config = read("app/core/config.py")
    routes = read("app/api/routes/whatsapp.py")
    setup = read("app/services/meta_setup.py")

    assert "public_api_base_url" in config
    assert "webhook-status" in routes
    assert "ensure-webhook" in routes
    assert "ensure_whatsapp_account_webhook" in setup
