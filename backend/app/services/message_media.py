"""Extract displayable media fields from stored message payloads."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message, MessageDirection, MessageType
from app.models.uploaded_file import UploadedFile
from app.services.storage import storage
from app.services.template_media import get_template_header_info

_MEDIA_CONTENT_PREFIX = {
    MessageType.IMAGE.value: "image/",
    MessageType.VIDEO.value: "video/",
    MessageType.AUDIO.value: "audio/",
    MessageType.DOCUMENT.value: "application/pdf",
}


def extract_message_media(message: Message) -> dict:
    payload = message.provider_payload if isinstance(message.provider_payload, dict) else {}
    message_type = message.type.value if hasattr(message.type, "value") else str(message.type)

    object_key = payload.get("object_key")
    filename = payload.get("filename")
    caption = message.text_body or payload.get("caption")
    media_url = payload.get("media_url") or payload.get("url")

    if object_key:
        media_url = storage.create_presigned_download_url(str(object_key), expires_seconds=3600)
        filename = filename or str(object_key).rsplit("/", 1)[-1]

    if media_url:
        return {
            "media_url": str(media_url),
            "media_filename": str(filename) if filename else None,
            "media_caption": caption,
        }

    for block_key in ("image", "video", "audio", "document", "sticker"):
        block = payload.get(block_key)
        if not isinstance(block, dict):
            continue
        block_caption = block.get("caption")
        block_name = block.get("filename")
        return {
            "media_url": None,
            "media_filename": str(block_name) if block_name else None,
            "media_caption": block_caption or caption,
        }

    if message_type in {MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.DOCUMENT}:
        return {
            "media_url": None,
            "media_filename": str(filename) if filename else None,
            "media_caption": caption,
        }

    if message_type == MessageType.TEMPLATE:
        header = get_template_header_info(payload.get("components"))
        if header and header.get("media_url"):
            return {
                "media_url": str(header["media_url"]),
                "media_filename": str(header.get("filename")) if header.get("filename") else None,
                "media_caption": caption,
            }

    return {
        "media_url": None,
        "media_filename": None,
        "media_caption": caption,
    }


async def enrich_message_media(db: AsyncSession, message: Message) -> dict:
    """Resolve media URLs from stored payload, with upload fallback for outbound sends."""
    media = extract_message_media(message)
    if media.get("media_url"):
        return media

    message_type = message.type.value if hasattr(message.type, "value") else str(message.type)
    if message.direction != MessageDirection.OUTBOUND:
        return media
    content_prefix = _MEDIA_CONTENT_PREFIX.get(message_type)
    if not content_prefix:
        return media

    window_start = message.created_at - timedelta(minutes=2)
    result = await db.execute(
        select(UploadedFile)
        .where(
            UploadedFile.account_id == message.account_id,
            UploadedFile.deleted_at.is_(None),
            UploadedFile.scan_status == "available",
            UploadedFile.created_at <= message.created_at,
            UploadedFile.created_at >= window_start,
            UploadedFile.content_type.like(f"{content_prefix}%")
            if content_prefix.endswith("/")
            else UploadedFile.content_type == content_prefix,
        )
        .order_by(UploadedFile.created_at.desc())
        .limit(1)
    )
    uploaded = result.scalar_one_or_none()
    if uploaded is None:
        return media

    media_url = storage.resolve_accessible_url(uploaded.object_key, expires_seconds=3600)
    return {
        "media_url": media_url,
        "media_filename": uploaded.filename,
        "media_caption": media.get("media_caption"),
    }
