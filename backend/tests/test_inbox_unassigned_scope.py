from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_conversation_list_supports_unassigned_inbox_scope() -> None:
    service = read("app/services/conversations.py")
    routes = read("app/api/routes/conversations.py")
    assert 'elif scope == "unassigned":' in service
    assert "assigned_membership_id.is_(None)" in service
    assert "unassigned" in routes


def test_inbox_page_exposes_unassigned_scope_tab() -> None:
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert '"unassigned"' in page
    assert "غير معيّنة" in page
    assert 'inboxScope === "unassigned"' in page


def test_offer_follow_up_automation_template_exists() -> None:
    templates = read("../frontend/src/lib/automationTemplates.ts")
    assert 'id: "offer-follow-up"' in templates
    assert "متابعة عرض لم يُحجز" in templates
    assert 'type: "delay"' in templates
    assert "minutes: 1440" in templates
