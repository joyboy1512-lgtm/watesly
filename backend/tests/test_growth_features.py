"""Tests for growth phases A–C (feature flags, preflight, follow-up, AI agents)."""

from app.services.feature_flags import DEFAULT_FLAGS, FLAG_LABELS_AR, feature_flags_metadata
from app.services.template_media import get_template_header_info
from app.services.whatsapp_window import _build_preflight_checks


def test_growth_feature_flags_defaults_off_for_meta_touching():
    assert DEFAULT_FLAGS["carousel_templates"] is False
    assert DEFAULT_FLAGS["fast_campaigns"] is False
    assert DEFAULT_FLAGS["meta_capi"] is False
    assert DEFAULT_FLAGS["follow_up_campaigns"] is False
    assert DEFAULT_FLAGS["shopify_integration"] is False


def test_ctwa_dashboard_flag_on_by_default():
    assert DEFAULT_FLAGS["ctwa_dashboard"] is True


def test_feature_flags_metadata_includes_labels():
    meta = feature_flags_metadata()
    assert "labels_ar" in meta
    assert meta["labels_ar"]["fast_campaigns"] == FLAG_LABELS_AR["fast_campaigns"]


def test_carousel_header_detection():
    components = [{"type": "HEADER", "format": "CAROUSEL", "cards": [{}, {}]}]
    info = get_template_header_info(components)
    assert info is not None
    assert info["format"] == "CAROUSEL"
    assert info["card_count"] == 2


def test_preflight_checks_carousel_info():
    checks = _build_preflight_checks(
        contact_ids=["a"],
        never_messaged=0,
        window_open=1,
        window_closed=0,
        category="marketing",
        quality_rating=None,
        messaging_limit=None,
        template_components=[{"type": "HEADER", "format": "CAROUSEL", "cards": [{}]}],
    )
    codes = [item["code"] for item in checks]
    assert "carousel_template" in codes
