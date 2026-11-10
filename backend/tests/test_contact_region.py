from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_contact_region_field_wired_end_to_end() -> None:
    migration = read("alembic/versions/0063_contact_region.py")
    model = read("app/models/contact.py")
    schema = read("app/schemas/contact.py")
    routes = read("app/api/routes/contacts.py")
    contacts = read("app/services/contacts.py")
    management = read("app/services/contact_management.py")
    campaigns = read("../frontend/src/pages/CampaignsPage.tsx")
    create_page = read("../frontend/src/pages/ContactCreatePage.tsx")
    detail = read("../frontend/src/pages/ContactDetailPage.tsx")
    helpers = read("../frontend/src/lib/contactHelpers.ts")

    assert 'revision = "0063_contact_region"' in migration
    assert "region: Mapped[str | None]" in model
    assert "region: str | None = None" in schema
    assert '@router.get("/regions")' in routes
    assert "async def list_contact_regions" in contacts
    assert 'region: str | None = Query(None' in routes
    assert '"region"' in management
    assert "audienceRegion" in campaigns
    assert "contactRegions" in campaigns
    assert "المنطقة" in create_page
    assert "المنطقة" in detail
    assert "region?:" in helpers or "region:" in helpers
