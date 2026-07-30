from app.services.whatsapp_health import parse_phone_health, tier_to_daily_limit, format_tier_hint


def test_parse_phone_health() -> None:
    parsed = parse_phone_health({
        "display_phone_number": "+96550000000",
        "verified_name": "My Shop",
        "quality_rating": "GREEN",
        "messaging_limit_tier": "TIER_1K",
    })
    assert parsed["quality_rating"] == "GREEN"
    assert parsed["messaging_limit"] == 1_000


def test_tier_to_daily_limit() -> None:
    assert tier_to_daily_limit("TIER_10K") == 10_000
    assert tier_to_daily_limit("TIER_UNLIMITED") is None


def test_format_tier_hint() -> None:
    hint = format_tier_hint("TIER_1K", 1000)
    assert "1,000" in hint
