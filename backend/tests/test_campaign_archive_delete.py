from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_archive_service_and_routes_exist() -> None:
    service = read("app/services/campaigns.py")
    routes = read("app/api/routes/campaigns.py")
    model = read("app/models/campaign.py")
    schema = read("app/schemas/campaign.py")

    assert "archived_at" in model
    assert "archived_at" in schema
    assert "async def archive_campaign" in service
    assert "async def unarchive_campaign" in service
    assert "async def delete_draft_campaign" in service
    assert "Campaign.archived_at.is_(None)" in service
    assert "CampaignStatus.DRAFT" in service
    assert "CAMPAIGN_HAS_FOLLOW_UPS" in service
    assert "/archive" in routes
    assert "/unarchive" in routes
    assert '@router.delete("/{campaign_id}"' in routes
    assert "archived_only" in routes


def test_campaign_archive_migration_exists() -> None:
    migration = read("alembic/versions/0045_campaign_archived_at.py")
    assert 'revision: str = "0045"' in migration
    assert "archived_at" in migration


def test_campaigns_page_has_archive_and_delete_ui() -> None:
    page = read("../frontend/src/pages/CampaignsPage.tsx")
    panel = read("../frontend/src/components/CampaignRecipientsPanel.tsx")

    assert "archiveFilter" in page
    assert "archived_only" in page
    assert "onArchive" in page
    assert "onDeleteDraft" in page
    assert "archiveCampaign" in panel
    assert "deleteDraftCampaign" in panel
    assert "أرشفة" in panel
