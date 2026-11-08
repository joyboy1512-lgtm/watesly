from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_sent_period_helpers_exist() -> None:
    reachability = read("app/services/contact_reachability.py")
    schemas = read("app/schemas/campaign.py")
    campaigns = read("app/services/campaigns.py")
    window = read("app/services/whatsapp_window.py")
    routes = read("app/api/routes/campaigns.py")
    page = read("../frontend/src/pages/CampaignsPage.tsx")

    assert "get_campaign_sent_contact_ids_in_period" in reachability
    assert "filter_exclude_campaign_sent_in_period" in reachability
    assert "list_campaigns_in_period" in reachability
    assert "exclude_sent_in_period: bool = False" in schemas
    assert "exclude_sent_from" in schemas
    assert "exclude_campaign_ids" in schemas
    assert "ALL_RECIPIENTS_SENT_IN_PERIOD" in campaigns
    assert "sent_in_period" in window
    assert "campaigns_in_period" in window
    assert "ALL_RECIPIENTS_SENT_IN_PERIOD" in routes
    assert "excludeSentInPeriod" in page
    assert "فلتر حسب الحملة / التاريخ" in page
    assert "عزل التحديد: استبعد من أُرسل لهم في الفترة" in page
