"""Short-lived clarify / pending-product memory for the local sales agent."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from app.core.redis import redis_client

DIALOGUE_TTL_SECONDS = 30 * 60


def _key(account_id: UUID, conversation_id: UUID) -> str:
    return f"watesly:catalog:dialogue:{account_id}:{conversation_id}"


async def save_catalog_dialogue(
    *,
    account_id: UUID,
    conversation_id: UUID,
    state: dict[str, Any],
) -> None:
    await redis_client.setex(
        _key(account_id, conversation_id),
        DIALOGUE_TTL_SECONDS,
        json.dumps(state, ensure_ascii=False),
    )


async def load_catalog_dialogue(
    *,
    account_id: UUID,
    conversation_id: UUID,
) -> dict[str, Any] | None:
    raw = await redis_client.get(_key(account_id, conversation_id))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


async def clear_catalog_dialogue(*, account_id: UUID, conversation_id: UUID) -> None:
    await redis_client.delete(_key(account_id, conversation_id))
