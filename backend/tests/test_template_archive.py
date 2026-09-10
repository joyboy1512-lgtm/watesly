from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_template_archive_model_and_migration() -> None:
    model = read("app/models/whatsapp_template.py")
    migration = read("alembic/versions/0063_template_archive.py")
    assert "archived_at" in model
    assert 'revision = "0063_template_archive"' in migration


def test_template_archive_routes() -> None:
    routes = read("app/api/routes/templates.py")
    service = read("app/services/templates.py")
    assert "post_archive_template" in routes
    assert "post_unarchive_template" in routes
    assert "archived_only" in routes
    assert "async def archive_template" in service
    assert "async def unarchive_template" in service
    assert "WhatsAppTemplate.archived_at.is_(None)" in service


def test_templates_page_archive_actions() -> None:
    page = read("../frontend/src/pages/TemplatesPage.tsx")
    assert "archiveTemplate" in page
    assert "unarchiveTemplate" in page
    assert "عرض الأرشيف" in page
    assert "إلغاء الأرشفة" in page
    assert "templates.manage" in page
