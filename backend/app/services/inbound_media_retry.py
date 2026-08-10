"""Retry downloading inbound WhatsApp media that failed on first attempt."""

from __future__ import annotations

from sqlalchemy import select

from app.core.encryption import decrypt_secret
from app.db.session import AsyncSessionFactory
from app.models.message import Message, MessageDirection, MessageType
from app.models.whatsapp_account import WhatsAppAccount
from app.services.whatsapp_media import MEDIA_MESSAGE_TYPES, store_inbound_whatsapp_media


async def retry_failed_inbound_media(*, limit: int = 25) -> dict:
    retried = updated = 0
    async with AsyncSessionFactory() as db:
        result = await db.execute(
            select(Message)
            .where(
                Message.direction == MessageDirection.INBOUND,
                Message.type.in_(tuple(MEDIA_MESSAGE_TYPES)),
            )
            .order_by(Message.created_at.desc())
            .limit(limit * 4)
        )
        for message in result.scalars().all():
            payload = message.provider_payload if isinstance(message.provider_payload, dict) else {}
            if not payload.get("media_download_failed"):
                continue
            meta_media_id = payload.get("meta_media_id")
            if not meta_media_id:
                continue
            channel_wa = await db.execute(
                select(WhatsAppAccount).where(WhatsAppAccount.channel_id == message.channel_id)
            )
            wa = channel_wa.scalar_one_or_none()
            if wa is None:
                continue
            item = {message.type.value: {"id": meta_media_id}}
            if payload.get("caption"):
                item[message.type.value]["caption"] = payload["caption"]
            retried += 1
            media_fields = await store_inbound_whatsapp_media(
                whatsapp_account=wa,
                item=item,
                message_type=message.type,
                access_token=decrypt_secret(wa.access_token_encrypted),
            )
            if media_fields.get("media_download_failed"):
                continue
            merged = {**payload, **media_fields}
            merged.pop("media_download_failed", None)
            message.provider_payload = merged
            updated += 1
            if retried >= limit:
                break
        if updated:
            await db.commit()
    return {"retried": retried, "updated": updated}
