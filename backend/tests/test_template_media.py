from app.services.template_media import (
    build_send_components,
    build_stored_components,
    content_type_to_header_format,
    get_template_header_info,
    is_ephemeral_meta_media_url,
    meta_safe_media_url,
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


def test_meta_safe_media_url_encodes_spaces() -> None:
    raw = "https://files.example.com/bucket/file name with spaces.mp4"
    assert meta_safe_media_url(raw) == "https://files.example.com/bucket/file%20name%20with%20spaces.mp4"
    send = build_send_components(
        [{"type": "HEADER", "format": "VIDEO", "media_url": raw}],
    )
    assert "%20" in send[0]["parameters"][0]["video"]["link"]


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


def test_get_template_header_info_skips_ephemeral_meta_cdn() -> None:
    info = get_template_header_info([
        {
            "type": "HEADER",
            "format": "VIDEO",
            "example": {"header_handle": ["https://scontent.whatsapp.net/video.mp4"]},
        }
    ])
    assert info is None


def test_resolve_send_components_ignores_ephemeral_recipient_media() -> None:
    stored = build_stored_components(
        body_text="test",
        header_format="VIDEO",
        media_url="https://files.example.com/stable.mp4",
    )
    recipient = [{
        "type": "header",
        "parameters": [{"type": "video", "video": {"link": "https://scontent.whatsapp.net/expired.mp4"}}],
    }]
    resolved = resolve_send_components(stored, recipient)
    assert resolved[0]["parameters"][0]["video"]["link"] == "https://files.example.com/stable.mp4"


def test_is_ephemeral_meta_media_url() -> None:
    assert is_ephemeral_meta_media_url("https://scontent.whatsapp.net/v.mp4") is True
    assert is_ephemeral_meta_media_url("https://files.example.com/v.mp4") is False
