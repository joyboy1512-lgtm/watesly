from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_follow_up_campaign_auto_starts_after_creation() -> None:
    page = read("../frontend/src/pages/CampaignsPage.tsx")
    helpers = read("../frontend/src/lib/campaignHelpers.ts")
    panel = read("../frontend/src/components/CampaignRecipientsPanel.tsx")

    assert "export async function approveAndStartCampaign" in helpers
    assert "await approveAndStartCampaign(followUpId, requestOptions)" in page
    assert "تم بدء حملة المتابعة" in page
    assert "اعتماد وإرسال" in panel
    assert "onStartDraft" in panel
