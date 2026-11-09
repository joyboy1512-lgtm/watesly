from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_follow_up_types_exclude_already_sent() -> None:
    follow = read("app/services/campaign_follow_up.py")
    assert '"not_delivered": {CampaignRecipientStatus.FAILED}' in follow
    assert '"failed": {CampaignRecipientStatus.FAILED}' in follow
    assert '"not_read": {CampaignRecipientStatus.DELIVERED}' in follow
    assert "CampaignRecipientStatus.SENT" not in follow.split("FOLLOW_UP_TYPES")[1].split("}")[0]


def test_uncertain_delivery_markers_and_guards() -> None:
    guard = read("app/services/campaign_send_guard.py")
    assert "delivery state unknown" in guard
    assert "reconcile before retry" in guard
    assert "def is_uncertain_delivery_failure" in guard
    assert "def is_safe_to_resend_failure" in guard
    assert "async def reconcile_uncertain_failed_recipient" in guard


def test_retry_and_follow_up_wiring() -> None:
    follow = read("app/services/campaign_follow_up.py")
    recovery = read("app/services/campaign_recovery.py")
    routes = read("app/api/routes/campaigns.py")
    panel = read("../frontend/src/components/CampaignRecipientsPanel.tsx")

    assert "reconcile_uncertain_failed_recipient" in follow
    assert "skipped_duplicate_phone" in follow
    assert "reconcile_uncertain_failed_recipient" in recovery
    assert "NO_FAILED_RECIPIENTS_AFTER_RECONCILE" in recovery
    assert "NO_FAILED_RECIPIENTS_AFTER_RECONCILE" in routes
    assert 'onFollowUp?.(item.id, "failed")' in panel
    assert "متابعة الفاشل" in panel
    assert 'onFollowUp?.(item.id, "not_delivered")' not in panel
