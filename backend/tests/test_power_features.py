"""Tests for Watesly power features (phases A–E)."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.business_hours import DEFAULT_HOURS, is_within_business_hours
from app.services.ctwa_attribution import apply_referral_to_contact, extract_referral_fields
from app.services.feature_flags import DEFAULT_FLAGS
from app.services.inbound_interactive import extract_interactive_reply
from app.services.privacy_mask import mask_email, mask_phone


def test_extract_interactive_button_reply():
    payload = {
        "interactive": {
            "type": "button_reply",
            "button_reply": {"id": "buy_now", "title": "اشتري الآن"},
        }
    }
    result = extract_interactive_reply(payload)
    assert result is not None
    assert result["button_id"] == "buy_now"
    assert result["text"] == "اشتري الآن"


def test_extract_referral_fields_ctwa():
    payload = {
        "referral": {
            "source_type": "ad",
            "source_id": "120000",
            "headline": "عرض الصيف",
        }
    }
    fields = extract_referral_fields(payload)
    assert fields["utm_source"] == "ad"
    assert fields["utm_campaign"] == "عرض الصيف"


def test_apply_referral_to_contact():
    from types import SimpleNamespace

    contact = SimpleNamespace(referral_json=None, utm_source=None, utm_campaign=None)
    apply_referral_to_contact(
        contact,
        {"referral_json": {"source_type": "ad"}, "utm_source": "ad", "utm_campaign": "camp"},
    )
    assert contact.utm_source == "ad"
    assert contact.utm_campaign == "camp"


def test_business_hours_weekday_open():
    tz = ZoneInfo("Asia/Kuwait")
    monday_noon = datetime(2026, 8, 3, 12, 0, tzinfo=tz)
    assert is_within_business_hours(DEFAULT_HOURS, now=monday_noon.astimezone()) is True


def test_business_hours_saturday_closed():
    tz = ZoneInfo("Asia/Kuwait")
    saturday_noon = datetime(2026, 8, 8, 12, 0, tzinfo=tz)
    assert is_within_business_hours(DEFAULT_HOURS, now=saturday_noon.astimezone()) is False


def test_privacy_mask_phone():
    assert mask_phone("96550123456") == "965***56"


def test_privacy_mask_email():
    assert mask_email("user@example.com") == "us***@example.com"


def test_default_feature_flags_include_core():
    assert DEFAULT_FLAGS["ai_agent_auto_reply"] is True
    assert DEFAULT_FLAGS["sla_monitoring"] is True
    assert DEFAULT_FLAGS["instagram_channel"] is True


def test_automation_trigger_type_button_clicked():
    from app.models.automation import AutomationTriggerType

    assert AutomationTriggerType.BUTTON_CLICKED.value == "button_clicked"
