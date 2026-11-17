import inspect
from types import SimpleNamespace

from app.services import whatsapp_branding as branding
from app.services.meta_client import MetaWhatsAppClient


def test_pick_product_set_prefers_stored_id() -> None:
    account = SimpleNamespace(meta_catalog_product_set_id="set-2")
    product_sets = [
        {"id": "set-1", "name": "All Products"},
        {"id": "set-2", "name": "Featured"},
    ]
    assert branding._pick_product_set_id(account, product_sets) == "set-2"


def test_pick_product_set_prefers_all_products_name() -> None:
    account = SimpleNamespace(meta_catalog_product_set_id="")
    product_sets = [
        {"id": "set-9", "name": "Featured"},
        {"id": "set-1", "name": "All Products"},
    ]
    assert branding._pick_product_set_id(account, product_sets) == "set-1"


def test_pick_product_set_falls_back_to_first() -> None:
    account = SimpleNamespace(meta_catalog_product_set_id="missing")
    product_sets = [{"id": "set-only", "name": "Summer"}]
    assert branding._pick_product_set_id(account, product_sets) == "set-only"


def test_normalize_websites_trims_and_caps_at_two() -> None:
    assert branding._normalize_websites(None) is None
    assert branding._normalize_websites([" https://a.com ", "", "https://b.com", "https://c.com"]) == [
        "https://a.com",
        "https://b.com",
    ]


def test_update_whatsapp_business_profile_accepts_optional_fields() -> None:
    params = inspect.signature(MetaWhatsAppClient.update_whatsapp_business_profile).parameters
    for name in ("about", "address", "description", "email", "websites", "vertical", "profile_picture_handle"):
        assert name in params


def test_meta_client_has_reply_button_and_list_helpers() -> None:
    assert hasattr(MetaWhatsAppClient, "send_reply_buttons")
    assert hasattr(MetaWhatsAppClient, "send_list_message")
