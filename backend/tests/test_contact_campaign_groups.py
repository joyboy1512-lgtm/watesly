from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_group_helpers_exist() -> None:
    service = read("app/services/contact_campaign_groups.py")
    assert "def campaign_group_tag_name" in service
    assert 'CAMPAIGN_GROUP_PREFIX = "حملة:"' in service
    assert "async def tag_campaign_sent_recipients_as_group" in service
    assert "async def create_contact_group" in service
    assert "async def load_last_campaigns_for_contacts" in service


def test_contacts_api_exposes_last_campaign_and_groups() -> None:
    schema = read("app/schemas/contact.py")
    routes = read("app/api/routes/contacts.py")
    assert "last_campaign_id" in schema
    assert "last_campaign_name" in schema
    assert "last_campaign_at" in schema
    assert '@router.post("/groups")' in routes
    assert "load_last_campaigns_for_contacts" in routes
    assert "create_contact_group" in routes


def test_campaign_worker_tags_audience_group() -> None:
    worker = read("app/workers/campaign_tasks.py")
    assert "tag_campaign_sent_recipients_as_group" in worker
    assert "audience_group" in worker


def test_contacts_ui_shows_last_campaign_and_create_group() -> None:
    page = read("../frontend/src/pages/ContactsPage.tsx")
    helpers = read("../frontend/src/lib/contactHelpers.ts")
    assert "last_campaign_at" in helpers
    assert "آخر حملة" in page
    assert "إنشاء مجموعة" in page
    assert "/contacts/groups" in page
    assert "المجموعات" in page
