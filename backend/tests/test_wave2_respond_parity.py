from pathlib import Path

from app.services.ai_agent_skills import normalize_skills_json


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_collaborations_scope_and_column_wired() -> None:
    model = read("app/models/conversation.py")
    service = read("app/services/conversations.py")
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert "collaborator_membership_ids" in model
    assert 'scope == "collaborations"' in service
    assert "مساعدات" in page
    assert "collaborator_membership_ids" in page


def test_close_dialog_has_summarize_affordance() -> None:
    dialog = read("../frontend/src/components/InboxCloseDialog.tsx")
    page = read("../frontend/src/pages/InboxPage.tsx")
    assert "onSummarize" in dialog
    assert "تلخيص بالذكاء" in dialog
    assert "summarizeClosingNote" in page


def test_conversation_closed_trigger_and_templates() -> None:
    automation_model = read("app/models/automation.py")
    templates = read("../frontend/src/lib/automationTemplates.ts")
    automations_page = read("../frontend/src/pages/AutomationsPage.tsx")
    assert 'CONVERSATION_CLOSED = "conversation_closed"' in automation_model
    assert 'id: "campaign-cta-route"' in templates
    assert 'id: "csat-after-close"' in templates
    assert "conversation_closed" in automations_page


def test_inbound_applies_agent_skills_hook() -> None:
    inbound = read("app/services/inbound_whatsapp.py")
    skills = read("app/services/ai_agent_skills.py")
    assert "apply_inbound_skills" in inbound
    assert "async def apply_inbound_skills" in skills
    normalized = normalize_skills_json({"assign_to_human": True, "http_request": True})
    assert normalized["assign_to_human"] is True
    assert normalized["http_request"] is True
