from pathlib import Path

from app.models.automation import AutomationTriggerType
from app.services.automation_triggers import _matches_trigger_config
from app.services.meta_capi import meta_capi_status


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class _Auto:
    def __init__(self, config: dict):
        self.trigger_config = config


def test_lifecycle_changed_trigger_exists() -> None:
    assert AutomationTriggerType.LIFECYCLE_CHANGED.value == "lifecycle_changed"
    model = read("app/models/automation.py")
    assert 'LIFECYCLE_CHANGED = "lifecycle_changed"' in model


def test_lifecycle_trigger_config_matching() -> None:
    auto = _Auto({"lifecycle_stage": "proposal"})
    assert _matches_trigger_config(auto, {"lifecycle_stage": "proposal"}) is True
    assert _matches_trigger_config(auto, {"lifecycle_stage": "won"}) is False
    assert _matches_trigger_config(_Auto({}), {"lifecycle_stage": "lead"}) is True


def test_offer_follow_up_bound_to_proposal() -> None:
    templates = read("../frontend/src/lib/automationTemplates.ts")
    assert 'id: "offer-follow-up"' in templates
    assert 'trigger_type: "lifecycle_changed"' in templates
    assert 'lifecycle_stage: "proposal"' in templates
    assert 'id: "campaign-cta-interested"' in templates
    assert 'id: "campaign-cta-human"' in templates
    assert 'id: "campaign-cta-stop"' in templates


def test_automations_page_supports_lifecycle_trigger() -> None:
    page = read("../frontend/src/pages/AutomationsPage.tsx")
    assert "lifecycle_changed" in page
    assert "triggerLifecycleStage" in page


def test_meta_capi_purchase_and_status_wired() -> None:
    growth = read("app/workers/growth_tasks.py")
    crm = read("app/services/crm.py")
    platform = read("app/api/routes/platform.py")
    developer = read("../frontend/src/pages/DeveloperPage.tsx")
    assert "send_meta_capi_purchase" in growth
    assert "send_meta_capi_purchase" in crm
    assert "integrations/meta-capi" in platform
    assert "meta-capi-status" in developer
    status = meta_capi_status(flag_enabled=False)
    assert status["flag_enabled"] is False
    assert status["ready"] is False
    assert "Lead" in status["events"]
    assert "Purchase" in status["events"]


def test_handoff_summary_on_escalate() -> None:
    skills = read("app/services/ai_agent_skills.py")
    assert "write_handoff_summary" in skills
    assert "build_handoff_summary_note" in skills
    assert "[تسليم من المساعد الذكي]" in skills
