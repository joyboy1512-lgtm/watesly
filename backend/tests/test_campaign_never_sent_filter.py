from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_only_never_sent_campaign_filter_exists() -> None:
    schemas = read("app/schemas/campaign.py")
    reachability = read("app/services/contact_reachability.py")
    campaigns = read("app/services/campaigns.py")
    window = read("app/services/whatsapp_window.py")
    routes = read("app/api/routes/campaigns.py")
    page = read("../frontend/src/pages/CampaignsPage.tsx")

    assert "only_never_sent: bool = False" in schemas
    assert "get_previously_sent_contact_ids" in reachability
    assert "filter_never_sent_contact_ids" in reachability
    assert "ALL_RECIPIENTS_PREVIOUSLY_SENT" in campaigns
    assert "only_never_sent" in window
    assert "never_sent_contact_ids" in window
    assert "ALL_RECIPIENTS_PREVIOUSLY_SENT" in routes
    assert "onlyNeverSent" in page
    assert "عملاء جدد فقط" in page
    assert "عزل التحديد" in page
