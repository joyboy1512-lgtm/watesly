import pytest

from app.services.automations import validate_publishable_graph


def test_valid_automation_graph() -> None:
    validate_publishable_graph(
        {
            "nodes": [
                {"id": "trigger", "type": "trigger", "data": {}, "position": {}},
                {"id": "action", "type": "send_text", "data": {}, "position": {}},
            ],
            "edges": [
                {"id": "edge", "source": "trigger", "target": "action"},
            ],
        }
    )


def test_automation_accepts_send_template_node() -> None:
    validate_publishable_graph(
        {
            "nodes": [
                {"id": "trigger", "type": "trigger", "data": {}, "position": {}},
                {"id": "tpl", "type": "send_template", "data": {}, "position": {}},
            ],
            "edges": [{"id": "edge", "source": "trigger", "target": "tpl"}],
        }
    )


def test_condition_field_aliases_in_worker() -> None:
    from app.workers.automation_tasks import _evaluate_condition

    context = {"trigger": {"text": "أريد السعر", "from": "96550000000"}}
    assert _evaluate_condition({"field": "text", "operator": "contains", "value": "سعر"}, context)
    assert _evaluate_condition({"field": "trigger.text", "operator": "contains", "value": "سعر"}, context)
    assert not _evaluate_condition({"field": "trigger.text", "operator": "contains", "value": "شكوى"}, context)


def test_automation_accepts_phase3_nodes() -> None:
    validate_publishable_graph(
        {
            "nodes": [
                {"id": "trigger", "type": "trigger", "data": {}, "position": {}},
                {"id": "catalog", "type": "send_catalog", "data": {}, "position": {}},
                {"id": "ai", "type": "ai_reply", "data": {}, "position": {}},
                {"id": "deal", "type": "create_deal", "data": {}, "position": {}},
            ],
            "edges": [
                {"id": "e1", "source": "trigger", "target": "catalog"},
                {"id": "e2", "source": "catalog", "target": "ai"},
                {"id": "e3", "source": "ai", "target": "deal"},
            ],
        }
    )


def test_automation_stats_route_exists() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    source = (root / "app" / "api" / "routes" / "automations.py").read_text(encoding="utf-8")
    service = (root / "app" / "services" / "automations.py").read_text(encoding="utf-8")
    assert "/stats" in source
    assert "get_automation_stats" in service


def test_automation_rejects_cycle() -> None:
    with pytest.raises(ValueError, match="AUTOMATION_GRAPH_CYCLE"):
        validate_publishable_graph(
            {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "data": {}, "position": {}},
                    {"id": "a", "type": "send_text", "data": {}, "position": {}},
                ],
                "edges": [
                    {"id": "e1", "source": "trigger", "target": "a"},
                    {"id": "e2", "source": "a", "target": "trigger"},
                ],
            }
        )
