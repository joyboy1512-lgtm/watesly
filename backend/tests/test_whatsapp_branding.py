from types import SimpleNamespace

from app.services import whatsapp_branding as branding


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
