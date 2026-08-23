from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_catalog_service_builds_price_reply() -> None:
    source = read("app/services/catalog.py")
    assert "build_catalog_reply" in source
    assert "suggest_catalog_reply" in source
    assert "search_catalog_products" in source


def test_inbound_whatsapp_publishes_catalog_ai_suggestion() -> None:
    source = read("app/services/inbound_whatsapp.py")
    assert "suggest_catalog_reply" in read("app/services/catalog.py")
    assert "ai.catalog_suggestion" in source


def test_catalog_phase3_commerce() -> None:
    meta = read("app/services/meta_client.py")
    commerce = read("app/services/catalog_commerce.py")
    routes = read("app/api/routes/catalog.py")
    whatsapp = read("app/api/routes/whatsapp.py")
    assert "send_single_product" in meta
    assert "send_product_list" in meta
    assert "prepare_catalog_commerce_ids" in commerce
    assert "/prepare-commerce" in routes
    assert "/categories" in routes
    assert "/commerce" in whatsapp
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    assert "sendProductCard" in inbox


def test_catalog_api_routes_exist() -> None:
    router = read("app/api/router.py")
    routes = read("app/api/routes/catalog.py")
    catalog = read("app/services/catalog.py")
    assert "catalog_router" in router
    assert "/suggest-reply" in routes
    assert "/import" in routes
    assert "/export" in routes
    assert "/preview-reply" in routes
    assert "organization_id" in routes
    assert "export_catalog_csv" in catalog
    assert "preview_catalog_reply" in catalog
    frontend = read("../frontend/src/pages/CatalogPage.tsx")
    assert "contacts-erp-table" in frontend
    assert "catalog/preview-reply" in frontend
    assert "prepare-commerce" in frontend
    assert "refresh-meta-status" in routes
    assert "sync-meta" in routes
    assert "variant-groups" in routes
    assert "/bulk-purge" in routes
    assert "bulk_purge_catalog_products" in catalog
    assert "build_meta_catalog_product_payload" in read("app/services/catalog_commerce.py")
    assert "meta_sync_enabled" in routes
    assert "catalogMetaStatusLabel" in read("../frontend/src/lib/catalogHelpers.ts")
    assert "InboxProductPicker" in read("../frontend/src/pages/InboxPage.tsx")
    assert "ai.catalog_suggestion" in read("../frontend/src/pages/InboxPage.tsx")


def test_campaign_audience_import_route_exists() -> None:
    routes = read("app/api/routes/campaigns.py")
    assert "/import-audience" in routes
