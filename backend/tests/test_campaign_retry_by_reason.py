from pathlib import Path

from app.services.campaign_failure_reasons import (
    CampaignFailureReason,
    classify_campaign_failure,
    group_failed_recipients,
)


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_classify_campaign_failure_reasons() -> None:
    assert classify_campaign_failure("(#131026) Message undeliverable") == CampaignFailureReason.UNREACHABLE
    assert classify_campaign_failure("Rate limit hit, try again") == CampaignFailureReason.RATE_LIMIT
    assert classify_campaign_failure("Invalid phone number") == CampaignFailureReason.INVALID_PHONE
    assert classify_campaign_failure("Marketing opt-out") == CampaignFailureReason.OPT_OUT
    assert classify_campaign_failure("Template parameter missing") == CampaignFailureReason.TEMPLATE_POLICY
    assert classify_campaign_failure("Something unknown") == CampaignFailureReason.OTHER


def test_group_failed_recipients_counts() -> None:
    groups = group_failed_recipients(
        [
            ("a", "Rate limit hit"),
            ("b", "Rate limit again"),
            ("c", "not on whatsapp"),
            ("d", None),
        ]
    )
    by_key = {item["reason_key"]: item["count"] for item in groups}
    assert by_key["rate_limit"] == 2
    assert by_key["unreachable"] == 1
    assert by_key["other"] == 1


def test_retry_by_reason_wiring() -> None:
    recovery = read("app/services/campaign_recovery.py")
    schemas = read("app/schemas/campaign.py")
    routes = read("app/api/routes/campaigns.py")
    panel = read("../frontend/src/components/CampaignRecipientsPanel.tsx")

    assert "list_campaign_failed_reasons" in recovery
    assert "reason_keys" in recovery
    assert "class CampaignRetryFailedRequest" in schemas
    assert 'failed-reasons"' in routes or "/failed-reasons" in routes
    assert "retry-failed" in routes
    assert "إعادة إرسال الفاشلة حسب السبب" in panel
    assert "reason_keys" in panel
