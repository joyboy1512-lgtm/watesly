from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_preflight_returns_eligible_contact_ids() -> None:
    reachability = read("app/services/contact_reachability.py")
    window = read("app/services/whatsapp_window.py")
    page = read("../frontend/src/pages/CampaignsPage.tsx")

    assert "async def list_campaign_eligible_contact_ids" in reachability
    assert "eligible_contact_ids" in window
    assert '"eligible_contact_ids": [str(item) for item in eligible_contact_ids]' in window
    assert "applyEligibleAudienceOnly" in page
    assert 'audienceMode === "excel"' in page
    assert "جدول جمهور الحملة" in page
    assert "رفع Excel وقفل الجمهور" in page


def test_contacts_list_supports_ids_filter_for_excel_lock() -> None:
    routes = read("app/api/routes/contacts.py")
    contacts = read("app/services/contacts.py")
    page = read("../frontend/src/pages/CampaignsPage.tsx")

    assert 'ids: str | None = Query(None' in routes
    assert "contact_ids: list[UUID] | None = None" in contacts
    assert 'ids: chunk.join(",")' in page
    assert "campaigns-audience-table" in page
