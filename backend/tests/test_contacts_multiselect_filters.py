from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_contacts_api_supports_multi_filters() -> None:
    routes = read("app/api/routes/contacts.py")
    service = read("app/services/contacts.py")
    page = read("../frontend/src/pages/ContactsPage.tsx")
    campaigns = read("../frontend/src/pages/CampaignsPage.tsx")
    component = read("../frontend/src/components/SearchableMultiFilter.tsx")

    assert "organization_ids" in routes
    assert "channel_ids" in routes
    assert "lifecycle_stages" in routes
    assert "whatsapp_statuses" in routes
    assert "last_campaign_ids" in routes
    assert "def _whatsapp_status_clause" in service
    assert 'variant="header"' in page
    assert "SearchableMultiFilter" in campaigns
    assert "campaign-audience-filters-top" in campaigns
    assert "contacts-erp-table-filter-headers" in page
    assert "تحديد الظاهر" in component
    assert 'variant?: "default" | "header"' in component
