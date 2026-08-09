from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.models.message import MessageDirection, MessageType
from app.services.message_media import enrich_message_media, extract_message_media


def test_extract_message_media_preserves_media_with_delivery_status() -> None:
    message = SimpleNamespace(
        type=MessageType.IMAGE,
        text_body=None,
        provider_payload={
            "media_url": "https://files.example.com/photo.jpg",
            "object_key": "accounts/123/photo.jpg",
            "filename": "photo.jpg",
            "delivery_status": {"status": "delivered", "id": "wamid.test"},
        },
    )
    with patch(
        "app.services.message_media.storage.create_presigned_download_url",
        return_value="https://signed.example/photo.jpg",
    ):
        media = extract_message_media(message)
    assert media["media_url"] == "https://signed.example/photo.jpg"
    assert media["media_filename"] == "photo.jpg"


@pytest.mark.asyncio
async def test_enrich_message_media_falls_back_to_recent_upload() -> None:
    account_id = uuid4()
    created_at = SimpleNamespace()
    message = SimpleNamespace(
        id=uuid4(),
        account_id=account_id,
        direction=MessageDirection.OUTBOUND,
        type=MessageType.VIDEO,
        text_body=None,
        created_at=created_at,
        provider_payload={"delivery_status": {"status": "delivered"}},
    )
    uploaded = SimpleNamespace(
        object_key="accounts/123/demo.mp4",
        filename="demo.mp4",
    )
    mock_result = SimpleNamespace(scalar_one_or_none=lambda: uploaded)
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)

    with patch(
        "app.services.message_media.storage.resolve_accessible_url",
        return_value="https://signed.example/demo.mp4",
    ):
        media = await enrich_message_media(mock_db, message)

    assert media["media_url"] == "https://signed.example/demo.mp4"
    assert media["media_filename"] == "demo.mp4"
