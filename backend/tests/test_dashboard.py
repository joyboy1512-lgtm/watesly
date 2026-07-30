from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_dashboard_service_exposes_insights() -> None:
    source = read("app/services/dashboard.py")
    assert "_waiting_conversations" in source
    assert "_latest_campaign" in source
    assert "_dashboard_alerts" in source
    assert "csat_metrics" in source
    assert "sla_metrics" in source


def test_dashboard_schema_includes_new_fields() -> None:
    schema = read("app/schemas/dashboard.py")
    assert "waiting_conversations" in schema
    assert "latest_campaign" in schema
    assert "DashboardAlert" in schema
    assert "first_response_avg_minutes" in schema
