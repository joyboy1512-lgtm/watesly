from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_bulk_import_does_not_call_create_contact_per_row() -> None:
    source = read("app/services/contact_management.py")
    assert "async def import_contacts_from_rows" in source
    assert "infer_gender_from_name" in source
    assert "batch_count >= 100" in source
    assert "create_contact(db" not in source.split("async def import_contacts_from_rows")[1].split("async def import_contacts_csv")[0]


def test_import_route_has_arabic_errors() -> None:
    routes = read("app/api/routes/contacts.py")
    assert "صيغة الملف غير مدعومة" in routes
    assert "10 MB" in routes
