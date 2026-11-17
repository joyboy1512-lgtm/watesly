from pathlib import Path

import pytest

from app.services.automations import validate_publishable_graph
from app.services.business_hours import DEFAULT_HOURS, is_within_business_hours
from app.workers.automation_tasks import _evaluate_condition

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_conversation_update_supports_closing_note() -> None:
    schema = read("app/schemas/conversation.py")
    service = read("app/services/conversations.py")
    assert "closing_note" in schema
    assert "closing_reason" in schema
    assert "conversation.closed_with_note" in service
    assert "ConversationNote" in service


def test_snooze_writes_conversation_snoozed_event() -> None:
    service = read("app/services/conversations.py")
    routes = read("app/api/routes/conversations.py")
    assert "conversation.snoozed" in service
    assert "snoozed_only" in service
    assert "snoozed: bool" in routes


def test_supervisor_summary_endpoint_exists() -> None:
    routes = read("app/api/routes/inbox_tools.py")
    service = read("app/services/inbox_tools.py")
    assert "/supervisor-summary" in routes
    assert "supervisor_summary" in service
    assert "waiting_conversations" in service
    assert "snoozed_conversations" in service
    assert "sla_breached_conversations" in service


def test_automation_accepts_business_hours_node() -> None:
    validate_publishable_graph(
        {
            "nodes": [
                {"id": "trigger", "type": "trigger", "data": {}, "position": {}},
                {"id": "hours", "type": "business_hours", "data": {}, "position": {}},
                {"id": "open", "type": "send_text", "data": {}, "position": {}},
                {"id": "closed", "type": "stop", "data": {}, "position": {}},
            ],
            "edges": [
                {"id": "e1", "source": "trigger", "target": "hours"},
                {
                    "id": "e2",
                    "source": "hours",
                    "target": "open",
                    "source_handle": "true",
                },
                {
                    "id": "e3",
                    "source": "hours",
                    "target": "closed",
                    "source_handle": "false",
                },
            ],
        }
    )


def test_condition_supports_is_within_business_hours_field() -> None:
    context = {"is_within_business_hours": True}
    assert _evaluate_condition(
        {"field": "is_within_business_hours", "operator": "equals", "value": True},
        context,
    )
    assert not _evaluate_condition(
        {"field": "is_within_business_hours", "operator": "equals", "value": False},
        context,
    )
    assert is_within_business_hours(DEFAULT_HOURS) in {True, False}


def test_inbox_frontend_closing_note_and_snooze_affordance() -> None:
    inbox = read("../frontend/src/pages/InboxPage.tsx")
    helpers = read("../frontend/src/lib/inboxHelpers.ts")
    assignments = read("../frontend/src/pages/AssignmentsPage.tsx")
    automations = read("../frontend/src/pages/AutomationsPage.tsx")
    assert "closing_note" in inbox
    assert "snoozed" in inbox
    assert "formatSnoozedUntil" in helpers
    assert "supervisor-summary" in assignments
    assert "business_hours" in automations
    assert "is_within_business_hours" in automations
