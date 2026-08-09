"""Extract displayable media fields from stored message payloads."""

from __future__ import annotations

from app.models.message import Message, MessageType
from app.services.storage import storage
from app.services.template_media import get_template_header_info


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
