from app.services.meta_template_submit import normalize_template_name


def test_normalize_template_name() -> None:
    assert normalize_template_name("olive o love") == "olive_o_love"
    assert normalize_template_name("Welcome-Message") == "welcome_message"


def test_normalize_template_name_rejects_empty() -> None:
    try:
        normalize_template_name("!!!")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert str(exc) == "INVALID_TEMPLATE_NAME"
