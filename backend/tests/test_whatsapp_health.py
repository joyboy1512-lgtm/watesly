from app.models.whatsapp_account import WhatsAppAccountStatus
from app.services.whatsapp_health import (
    build_meta_status_message,
    derive_account_status_from_meta,
    parse_phone_health,
    parse_waba_health,
    resolve_effective_name_status,
    tier_to_daily_limit,
    format_tier_hint,
)


def test_parse_phone_health() -> None:
    parsed = parse_phone_health({
        "display_phone_number": "+96550000000",
        "verified_name": "My Shop",
        "quality_rating": "GREEN",
        "messaging_limit_tier": "TIER_1K",
        "status": "CONNECTED",
        "name_status": "APPROVED",
    })
    assert parsed["quality_rating"] == "GREEN"
    assert parsed["messaging_limit"] == 1_000
    assert parsed["meta_phone_status"] == "CONNECTED"
    assert parsed["meta_name_status"] == "APPROVED"


def test_parse_waba_health() -> None:
    parsed = parse_waba_health({
        "account_review_status": "APPROVED",
        "health_status": {
            "can_send_message": "AVAILABLE",
            "entities": [{"entity_type": "WABA", "can_send_message": "AVAILABLE"}],
        },
    })
    assert parsed["meta_account_review_status"] == "APPROVED"
    assert parsed["meta_can_send_message"] == "AVAILABLE"


def test_resolve_effective_name_status_approved_rename() -> None:
    assert resolve_effective_name_status("DECLINED", "APPROVED") == "APPROVED"
    assert resolve_effective_name_status("APPROVED", None) == "APPROVED"
    assert resolve_effective_name_status("DECLINED", "PENDING") == "PENDING"
    assert resolve_effective_name_status("DECLINED", None) == "DECLINED"


def test_parse_phone_health_uses_new_name_status() -> None:
    parsed = parse_phone_health({
        "display_phone_number": "+96560460048",
        "verified_name": "Olive",
        "quality_rating": "GREEN",
        "messaging_limit_tier": "TIER_1K",
        "status": "CONNECTED",
        "name_status": "DECLINED",
        "new_name_status": "APPROVED",
    })
    assert parsed["meta_name_status"] == "APPROVED"
    assert parsed["meta_new_name_status"] == "APPROVED"


def test_build_meta_status_message_declined_name() -> None:
    message = build_meta_status_message(
        meta_phone_status="CONNECTED",
        meta_name_status="DECLINED",
        meta_can_send_message="AVAILABLE",
        meta_account_review_status="APPROVED",
    )
    assert "اسم العرض مرفوض" in message


def test_derive_account_status_blocked() -> None:
    status = derive_account_status_from_meta(
        meta_phone_status="CONNECTED",
        meta_can_send_message="BLOCKED",
        meta_name_status="APPROVED",
    )
    assert status == WhatsAppAccountStatus.SUSPENDED


def test_derive_account_status_declined_name() -> None:
    status = derive_account_status_from_meta(
        meta_phone_status="CONNECTED",
        meta_can_send_message="AVAILABLE",
        meta_name_status="DECLINED",
    )
    assert status == WhatsAppAccountStatus.SUSPENDED


def test_derive_account_status_approved_after_rename() -> None:
    status = derive_account_status_from_meta(
        meta_phone_status="CONNECTED",
        meta_can_send_message="AVAILABLE",
        meta_name_status="APPROVED",
    )
    assert status == WhatsAppAccountStatus.ACTIVE


def test_tier_to_daily_limit() -> None:
    assert tier_to_daily_limit("TIER_10K") == 10_000
    assert tier_to_daily_limit("TIER_UNLIMITED") is None


def test_format_tier_hint() -> None:
    hint = format_tier_hint("TIER_1K", 1000)
    assert "1,000" in hint
