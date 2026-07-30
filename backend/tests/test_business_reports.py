from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_business_reports_service_exists() -> None:
    source = read("app/services/business_reports.py")
    assert "customer_report" in source
    assert "names_report" in source
    assert "engagement_report" in source
    assert "campaigns_report" in source
    assert "conversations_report" in source
    assert "inactivity_report" in source
    assert "catalog_report" in source
    assert "reports_overview" in source


def test_reports_api_routes_exist() -> None:
    routes = read("app/api/routes/reports.py")
    assert "/overview" in routes
    assert "/customers" in routes
    assert "/campaigns" in routes
    assert "/conversations" in routes
    assert "/inactivity" in routes
    assert "/catalog" in routes
    assert "/campaigns/export" in routes


def test_campaign_recipients_api_exists() -> None:
    routes = read("app/api/routes/reports.py")
    campaign_routes = read("app/api/routes/campaigns.py")
    campaigns = read("app/services/campaigns.py")
    assert "/recipients" in routes
    assert "/report" in campaign_routes
    assert "list_campaign_recipients" in campaigns
    assert "list_campaigns_with_reports" in campaigns
    assert "export_campaign_recipients_xlsx" in campaigns


def test_reports_page_component_exists() -> None:
    # Frontend lives outside the backend container; checked from workspace in CI/dev.
    page_path = Path(__file__).parents[2] / "frontend" / "src" / "pages" / "ReportsPage.tsx"
    if not page_path.exists():
        return
    source = page_path.read_text(encoding="utf-8")
    assert "التقارير" in source
    assert "engagement" in source
