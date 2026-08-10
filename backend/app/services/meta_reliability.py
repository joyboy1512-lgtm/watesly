"""Shared Meta API reliability helpers."""

from __future__ import annotations

import asyncio
import random
from typing import Any

from app.services.meta_client import MetaAPIError


def meta_retry_after_seconds(exc: MetaAPIError, *, attempt: int) -> float:
    response = exc.response_data if isinstance(exc.response_data, dict) else {}
    error = response.get("error") if isinstance(response.get("error"), dict) else {}
    retry_after = error.get("retry_after") or response.get("retry_after")
    if isinstance(retry_after, (int, float)) and retry_after > 0:
        return float(retry_after)
    if exc.status_code == 429:
        return min(120.0, (2 ** min(attempt, 6)) + random.random())
    if exc.status_code in {500, 502, 503, 504}:
        return min(60.0, (2 ** min(attempt, 4)) + random.random())
    return 0.0


def is_transient_meta_error(exc: MetaAPIError) -> bool:
    if exc.status_code == 429:
        return True
    return exc.status_code in {500, 502, 503, 504}


async def sleep_for_meta_backoff(exc: MetaAPIError, *, attempt: int) -> float:
    delay = meta_retry_after_seconds(exc, attempt=attempt)
    if delay > 0:
        await asyncio.sleep(delay)
    return delay


def delivery_status_event(
    *,
    account_id,
    message_id,
    conversation_id,
    status_value: str,
    external_id: str | None,
) -> dict[str, Any]:
    return {
        "type": "message.status_updated",
        "message_id": str(message_id),
        "conversation_id": str(conversation_id) if conversation_id else None,
        "status": status_value,
        "external_message_id": external_id,
        "account_id": str(account_id),
    }
