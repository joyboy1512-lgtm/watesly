"""Meta Conversions API — optional, gated by feature flag. Does not block WhatsApp flows."""

from __future__ import annotations

import hashlib
import logging
import os
from uuid import UUID

import httpx

from app.services.feature_flags import get_feature_flags

logger = logging.getLogger(__name__)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()


async def send_capi_event(
    db,
    *,
    account_id: UUID,
    event_name: str,
    phone: str | None = None,
    email: str | None = None,
    custom_data: dict | None = None,
) -> dict:
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("meta_capi"):
        return {"status": "skipped", "reason": "meta_capi_disabled"}

    pixel_id = os.getenv("META_CAPI_PIXEL_ID", "").strip()
    access_token = os.getenv("META_CAPI_ACCESS_TOKEN", "").strip()
    if not pixel_id or not access_token:
        return {"status": "skipped", "reason": "meta_capi_not_configured"}

    user_data: dict = {}
    if phone:
        user_data["ph"] = [_sha256(phone)]
    if email:
        user_data["em"] = [_sha256(email)]
    if not user_data:
        return {"status": "skipped", "reason": "no_user_identifiers"}

    payload = {
        "data": [
            {
                "event_name": event_name,
                "event_time": int(__import__("time").time()),
                "action_source": "business_messaging",
                "messaging_channel": "whatsapp",
                "user_data": user_data,
                "custom_data": custom_data or {},
            }
        ],
        "access_token": access_token,
    }

    url = f"https://graph.facebook.com/v21.0/{pixel_id}/events"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            body = response.json()
        return {"status": "sent", "events_received": body.get("events_received")}
    except Exception as exc:
        logger.warning("Meta CAPI event failed: %s", exc)
        return {"status": "failed", "error": str(exc)[:200]}
