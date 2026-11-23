from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_audience_table_has_requested_columns() -> None:
    page = read("../frontend/src/pages/CampaignsPage.tsx")
    schema = read("app/schemas/contact.py")
    serialization = read("app/services/contact_serialization.py")
    management = read("app/services/contact_management.py")

    for needle in [
        'label="الجنس"',
        'label="الفرع"',
        'label="القناة"',
        'label="المنطقة"',
        'label="التصنيف"',
        'label="الاهتمامات"',
        'label="حالة واتساب"',
        'label="المرحلة"',
        'label="آخر حملة"',
        "tag_labels",
        "formatLifecycleStage",
        "formatGenderLabel",
    ]:
        assert needle in page

    assert "tag_ids: list[UUID]" in schema
    assert "tag_labels: list[str]" in schema
    assert "tags_by_contact" in serialization
    assert "async def load_tags_for_contacts" in management
