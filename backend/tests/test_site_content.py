from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_site_content_routes_exist() -> None:
    routes = read("app/api/routes/site_content.py")
    router = read("app/api/router.py")
    assert "/site-content" in routes
    assert "public_router" in routes
    assert "site_content_router" in router
    assert 'prefix="/public"' in router


def test_platform_site_config_model_exists() -> None:
    model = read("app/models/platform_site_config.py")
    defaults = read("app/services/site_content_defaults.py")
    assert "PlatformSiteConfig" in model
    assert "default_site_config" in defaults


def test_site_content_frontend_page_exists() -> None:
    page = read("../frontend/src/pages/SiteContentPage.tsx")
    app = read("../frontend/src/App.tsx")
    assert "SiteContentPage" in page
    assert "/admin/site-content" in app
