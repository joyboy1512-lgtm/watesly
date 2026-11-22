from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_interest_create_accepts_label_only() -> None:
    routes = read("app/api/routes/platform.py")
    service = read("app/services/interests.py")
    assert "slug: str | None" in routes or "slug: str | None =" in routes
    assert "def slugify_interest_label" in service
    assert "INTEREST_SLUG_CONFLICT" in service


def test_contacts_list_supports_interest_filter() -> None:
    routes = read("app/api/routes/contacts.py")
    service = read("app/services/contacts.py")
    schema = read("app/schemas/contact.py")
    page = read("../frontend/src/pages/ContactsPage.tsx")
    campaigns = read("../frontend/src/pages/CampaignsPage.tsx")

    assert "interest_id" in routes
    assert "interest_ids" in routes
    assert "effective_interest_ids" in service
    assert "interest_labels" in schema
    assert "كل الاهتمامات" in page
    assert "+ اهتمام" in page
    assert "createAudienceInterest" in campaigns
    assert "الاهتمامات" in campaigns


def test_segment_filters_include_interest_id() -> None:
    helpers = read("../frontend/src/lib/contactHelpers.ts")
    management = read("app/services/contact_management.py")
    assert "interest_id" in helpers
    assert 'filters.get("interest_id")' in management
