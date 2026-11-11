from app.services.meta_template_submit import _build_meta_buttons, normalize_template_name


def test_normalize_template_name() -> None:
    assert normalize_template_name("olive o love") == "olive_o_love"
    assert normalize_template_name("Welcome-Message") == "welcome_message"


def test_normalize_template_name_rejects_empty() -> None:
    try:
        normalize_template_name("!!!")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert str(exc) == "INVALID_TEMPLATE_NAME"


def test_build_meta_buttons_includes_url_cta() -> None:
    buttons = _build_meta_buttons(
        [
            {"type": "URL", "text": "تسوق الآن", "url": "https://shop.example.com/offer"},
            {"type": "QUICK_REPLY", "text": "مهتم"},
            {"type": "QUICK_REPLY", "text": "عدم الإزعاج"},
        ]
    )
    assert buttons == [
        {
            "type": "URL",
            "text": "تسوق الآن",
            "url": "https://shop.example.com/offer",
            "example": ["https://shop.example.com/offer"],
        },
        {"type": "QUICK_REPLY", "text": "مهتم"},
        {"type": "QUICK_REPLY", "text": "عدم الإزعاج"},
    ]
