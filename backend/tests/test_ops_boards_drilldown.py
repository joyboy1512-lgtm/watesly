"""Unit tests for CRM follow-up filters, assignment simulation, and automation dry-run."""

from app.services.automations import simulate_automation_graph
from app.services.crm import LOSS_REASONS, OPEN_STAGES, deal_to_dict


class _Deal:
    def __init__(self, **kwargs):
        self.id = kwargs.get("id")
        self.title = kwargs.get("title", "t")
        self.stage = kwargs.get("stage", "lead")
        self.amount = kwargs.get("amount")
        self.currency = kwargs.get("currency", "KWD")
        self.pipeline = kwargs.get("pipeline", "default")
        self.contact_id = kwargs.get("contact_id")
        self.organization_id = kwargs.get("organization_id")
        self.assigned_membership_id = kwargs.get("assigned_membership_id")
        self.description = kwargs.get("description")
        self.probability = kwargs.get("probability", 0)
        self.source = kwargs.get("source")
        self.expected_close_date = kwargs.get("expected_close_date")
        self.loss_reason = kwargs.get("loss_reason")
        self.loss_reason_detail = kwargs.get("loss_reason_detail")
        self.next_step = kwargs.get("next_step")
        self.next_step_at = kwargs.get("next_step_at")
        self.conversation_id = kwargs.get("conversation_id")
        self.created_at = kwargs.get("created_at")
        self.updated_at = kwargs.get("updated_at")


def test_deal_amount_null_vs_zero():
    unset = deal_to_dict(_Deal(amount=None, stage="lost", loss_reason=None))
    zero = deal_to_dict(_Deal(amount=0, stage="lost", loss_reason="price"))
    assert unset["amount"] is None
    assert unset["amount_recorded"] is False
    assert unset["loss_reason"] == "unspecified"
    assert zero["amount"] == "0"
    assert zero["amount_recorded"] is True
    assert zero["loss_reason"] == "price"


def test_loss_reasons_include_unspecified():
    assert "unspecified" in LOSS_REASONS
    assert set(OPEN_STAGES) == {"lead", "qualified", "proposal"}


def test_simulate_automation_catalog_price_path():
    graph = {
        "nodes": [
            {"id": "t1", "type": "trigger", "data": {"label": "رسالة"}},
            {
                "id": "c1",
                "type": "condition",
                "data": {"label": "سعر؟", "field": "trigger.text", "operator": "contains", "value": "صابون"},
            },
            {
                "id": "s1",
                "type": "send_text",
                "data": {"label": "رد", "text": "سعر صابون الورد 2.500 د.ك"},
            },
            {"id": "x1", "type": "stop", "data": {"label": "إيقاف"}},
        ],
        "edges": [
            {"id": "e1", "source": "t1", "target": "c1"},
            {"id": "e2", "source": "c1", "target": "s1", "source_handle": "true", "label": "true"},
            {"id": "e3", "source": "c1", "target": "x1", "source_handle": "false", "label": "false"},
        ],
    }
    result = simulate_automation_graph(
        graph=graph,
        trigger_payload={"text": "عميل يسأل عن سعر صابون الورد"},
    )
    assert result["dry_run"] is True
    assert result["side_effects_blocked"] is True
    assert result["proposed_reply"] == "سعر صابون الورد 2.500 د.ك"
    types = [step["node_type"] for step in result["steps"]]
    assert types == ["trigger", "condition", "send_text"]


def test_simulate_automation_ai_conflict_note():
    graph = {
        "nodes": [
            {"id": "t1", "type": "trigger", "data": {}},
            {"id": "a1", "type": "ai_reply", "data": {"label": "ذكاء"}},
        ],
        "edges": [{"id": "e1", "source": "t1", "target": "a1"}],
    }
    result = simulate_automation_graph(graph=graph, trigger_payload={"text": "مرحبا"})
    assert result["ai_reply_would_run"] is True
    assert result["conflict_note"]
