"""Download inbound WhatsApp media from Meta and store in object storage."""

from __future__ import annotations

import mimetypes

from app.models.message import MessageType
from app.models.whatsapp_account import WhatsAppAccount
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.storage import storage

MEDIA_MESSAGE_TYPES = {
    MessageType.IMAGE,
    MessageType.VIDEO,
    MessageType.AUDIO,
    MessageType.DOCUMENT,
}


def _media_block(item: dict, message_type: MessageType) -> dict | None:
    block = item.get(message_type.value)
    if isinstance(block, dict):
        return block
    if message_type == MessageType.IMAGE and isinstance(item.get("sticker"), dict):
        return item["sticker"]
    return None


def _guess_filename(media_id: str, mime_type: str | None, message_type: MessageType) -> str:
    extension = mimetypes.guess_extension(mime_type or "", strict=False) if mime_type else None
    if not extension:
        defaults = {
            MessageType.IMAGE: ".jpg",
            MessageType.VIDEO: ".mp4",
            MessageType.AUDIO: ".ogg",
            MessageType.DOCUMENT: ".bin",
        }
        extension = defaults.get(message_type, ".bin")
    return f"{media_id}{extension}"


async def store_inbound_whatsapp_media(
    *,
    whatsapp_account: WhatsAppAccount,
    item: dict,
    message_type: MessageType,
    access_token: str,
) -> dict:
    block = _media_block(item, message_type)
    if not block:
        return {}

    media_id = block.get("id")
    if not media_id:
        return {}

    client = MetaWhatsAppClient(
        access_token=access_token,
        phone_number_id=whatsapp_account.phone_number_id,
    )
    try:
        content, mime_type, filename = await client.download_media(str(media_id))
    except MetaAPIError:
        return {"meta_media_id": media_id, "media_download_failed": True}
    finally:
        await client.aclose()

    safe_name = filename or _guess_filename(str(media_id), mime_type, message_type)
    object_key, _ = storage.upload_bytes(
        account_id=whatsapp_account.account_id,
        filename=safe_name,
        content_type=mime_type,
        content=content,
    )
    return {
        "meta_media_id": media_id,
        "object_key": object_key,
        "media_url": storage.resolve_accessible_url(object_key, expires_seconds=3600),
        "filename": safe_name,
        "mime_type": mime_type,
        "caption": block.get("caption"),
    }


def extract_inbound_text_and_caption(item: dict, message_type: MessageType) -> str | None:
    if message_type == MessageType.TEXT:
        return item.get("text", {}).get("body")
    block = _media_block(item, message_type)
    if isinstance(block, dict):
        return block.get("caption")
    return None
