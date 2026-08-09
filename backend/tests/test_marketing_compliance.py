from app.services.marketing_compliance import (
    append_marketing_opt_out_components,
    is_marketing_opt_out_request,
    template_has_opt_out_button,
)
from app.services.whatsapp_window import _build_preflight_checks


def test_is_marketing_opt_out_request_from_text() -> None:
    assert is_marketing_opt_out_request(text="إيقاف")
    assert is_marketing_opt_out_request(text="please STOP promotions")
    assert not is_marketing_opt_out_request(text="مرحباً")


def test_is_marketing_opt_out_request_from_button() -> None:
    assert is_marketing_opt_out_request(button_id="watesly_marketing_opt_out")
    assert is_marketing_opt_out_request(button_title="عدم الإزعاج")
    assert not is_marketing_opt_out_request(button_title="اطلب الآن")


def test_template_has_opt_out_button() -> None:
    components = [
        {
            "type": "BUTTONS",
            "buttons": [{"type": "QUICK_REPLY", "text": "عدم الإزعاج", "id": "watesly_marketing_opt_out"}],
        }
    ]
    assert template_has_opt_out_button(components)


def test_append_marketing_opt_out_components() -> None:
    components = append_marketing_opt_out_components([{"type": "BODY", "text": "عرض خاص"}])
    assert template_has_opt_out_button(components)
    assert any(item.get("type") == "FOOTER" for item in components)


def test_preflight_checks_marketing_opt_out() -> None:
    checks = _build_preflight_checks(
        contact_ids=["a", "b"],
        never_messaged=0,
        window_open=2,
        window_closed=0,
        category="marketing",
        quality_rating=None,
        messaging_limit=None,
        marketing_opt_out=1,
        eligible_recipients=1,
        include_opt_out_option=True,
        template_has_opt_out_button=True,
    )
    codes = [item["code"] for item in checks]
    assert "marketing_opt_out" in codes
    assert "opt_out_enabled" in codes
