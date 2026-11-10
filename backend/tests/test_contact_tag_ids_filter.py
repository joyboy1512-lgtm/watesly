from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_contacts_list_supports_multiple_tag_ids() -> None:
    routes = read("app/api/routes/contacts.py")
    contacts = read("app/services/contacts.py")
    page = read("../frontend/src/pages/CampaignsPage.tsx")
    detail = read("../frontend/src/pages/ContactDetailPage.tsx")

    assert 'tag_ids: str | None = Query(None' in routes
    assert "tag_ids: list[UUID] | None = None" in contacts
    assert "ContactTag.tag_id.in_(effective_tag_ids)" in contacts
    assert "audienceTagIds" in page
    assert "campaign-tag-multiselect" in page
    assert "ContactTagsEditor" in detail
    assert "تصنيف جديد" in detail
