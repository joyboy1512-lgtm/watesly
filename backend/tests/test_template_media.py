from app.services.template_media import (
    build_send_components,
    build_stored_components,
    content_type_to_header_format,
    get_template_header_info,
    resolve_send_components,
)


def test_build_stored_components_with_image_header() -> None:
    components = build_stored_components(
        body_text="مرحباً",
        header_format="IMAGE",
        media_url="https://cdn.example.com/a.jpg",
    )
    assert components[0]["type"] == "HEADER"
    assert components[0]["format"] == "IMAGE"
    assert components[1]["text"] == "مرحباً"


def test_build_send_components_document() -> None:
    stored = build_stored_components(
        body_text="ملف",
        header_format="DOCUMENT",
        media_url="https://cdn.example.com/a.pdf",
        filename="price.pdf",
    )
    send = build_send_components(stored)
    assert send[0]["type"] == "header"
    assert send[0]["parameters"][0]["type"] == "document"


def test_resolve_send_components_prefers_recipient_params() -> None:
    custom = [{"type": "header", "parameters": [{"type": "image", "image": {"link": "https://x/y.jpg"}}]}]
    resolved = resolve_send_components([], custom)
    assert resolved == custom


def test_content_type_mapping() -> None:
    assert content_type_to_header_format("image/png") == "IMAGE"
    assert content_type_to_header_format("video/mp4") == "VIDEO"
    assert content_type_to_header_format("application/pdf") == "DOCUMENT"
    assert content_type_to_header_format("audio/mpeg") is None


def test_get_template_header_info_from_meta_example() -> None:
    info = get_template_header_info([
        {"type": "HEADER", "format": "IMAGE", "example": {"header_url": ["https://cdn.example.com/h.jpg"]}}
    ])
    assert info is not None
    assert info["format"] == "IMAGE"
