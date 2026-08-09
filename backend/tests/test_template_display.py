from app.services.template_display import extract_template_fields, render_template_body_text


def test_render_template_body_text_from_components() -> None:
    components = [
        {"type": "HEADER", "format": "TEXT", "text": "Hello"},
        {"type": "BODY", "text": "مرحباً {{1}}"},
    ]
    assert render_template_body_text(components) == "مرحباً {{1}}"


def test_render_template_body_text_fallback() -> None:
    assert render_template_body_text([], fallback="Fallback body") == "Fallback body"


def test_extract_template_fields() -> None:
    fields = extract_template_fields(
        {
            "template_name": "welcome",
            "components": [{"type": "BODY", "text": "Hi"}],
        }
    )
    assert fields["template_name"] == "welcome"
    assert fields["template_components"] == [{"type": "BODY", "text": "Hi"}]
