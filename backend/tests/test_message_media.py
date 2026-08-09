from types import SimpleNamespace
from unittest.mock import patch

from app.models.message import MessageType
from app.services.message_media import extract_message_media


def _message(*, message_type: MessageType, provider_payload: dict, text_body: str | None = None):
    return SimpleNamespace(
        type=message_type,
        text_body=text_body,
        provider_payload=provider_payload,
    )


def test_extract_message_media_uses_object_key() -> None:
    message = _message(
        message_type=MessageType.IMAGE,
        provider_payload={
            "object_key": "accounts/123/photo.jpg",
            "filename": "photo.jpg",
            "meta_response": {"messages": [{"id": "wamid.test"}]},
        },
    )
    with patch("app.services.message_media.storage.create_presigned_download_url", return_value="https://signed.example/photo.jpg"):
        media = extract_message_media(message)
    assert media["media_url"] == "https://signed.example/photo.jpg"
    assert media["media_filename"] == "photo.jpg"


def test_extract_message_media_keeps_outbound_media_url_after_meta_response() -> None:
    message = _message(
        message_type=MessageType.VIDEO,
        text_body="فيديو تعريفي",
        provider_payload={
            "media_url": "https://cdn.example.com/accounts/123/demo.mp4",
            "filename": "demo.mp4",
            "meta_response": {"messages": [{"id": "wamid.test"}]},
        },
    )
    media = extract_message_media(message)
    assert media["media_url"] == "https://cdn.example.com/accounts/123/demo.mp4"
    assert media["media_filename"] == "demo.mp4"
    assert media["media_caption"] == "فيديو تعريفي"


def test_extract_message_media_without_media_url_returns_none_for_display() -> None:
    message = _message(
        message_type=MessageType.IMAGE,
        provider_payload={"messages": [{"id": "wamid.test"}]},
    )
    media = extract_message_media(message)
    assert media["media_url"] is None
