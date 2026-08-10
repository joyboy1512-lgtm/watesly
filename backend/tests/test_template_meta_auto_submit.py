from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_create_template_auto_submits_to_meta() -> None:
    templates = read("app/services/templates.py")
    routes = read("app/api/routes/templates.py")
    meta_client = read("app/services/meta_client.py")
    whatsapp = read("app/services/whatsapp.py")

    assert "submit_template_to_meta" in templates
    assert "refresh_pending_template_statuses" in templates
    assert "create_message_template" in meta_client
    assert "upload_template_sample" in meta_client
    assert "/submit" in routes
    assert "message_template_status_update" in whatsapp


def test_template_create_schema_does_not_accept_manual_status() -> None:
    schema = read("app/schemas/template.py")
    assert "status: TemplateStatus = TemplateStatus.DRAFT" not in schema
