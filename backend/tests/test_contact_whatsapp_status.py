from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_whatsapp_status_helpers_wired() -> None:
    reach = read("app/services/contact_reachability.py")
    schema = read("app/schemas/contact.py")
    routes = read("app/api/routes/contacts.py")
    contacts = read("app/services/contacts.py")
    page = read("../frontend/src/pages/ContactsPage.tsx")

    assert "class WhatsAppContactStatus" in reach
    assert "def resolve_whatsapp_contact_status" in reach
    assert "يقبل الاستلام" in reach
    assert "whatsapp_status" in schema
    assert "whatsapp_status_label" in schema
    assert "whatsapp_status" in routes
    assert 'status_filter == "dnd"' in contacts
    assert "حالة واتساب" in page
    assert "whatsapp_status" in page
