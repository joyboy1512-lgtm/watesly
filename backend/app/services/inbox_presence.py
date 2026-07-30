"""Inbox agent viewing/typing presence via Redis."""

from __future__ import annotations

import json
from uuid import UUID

from app.core.redis import redis_client

VIEW_TTL_SECONDS = 45
TYPING_TTL_SECONDS = 8


def _view_key(account_id: UUID, conversation_id: UUID, membership_id: UUID) -> str:
    return f"watesly:inbox:view:{account_id}:{conversation_id}:{membership_id}"


def _typing_key(account_id: UUID, conversation_id: UUID, membership_id: UUID) -> str:
    return f"watesly:inbox:typing:{account_id}:{conversation_id}:{membership_id}"


async def set_conversation_viewing(
    *,
    account_id: UUID,
    conversation_id: UUID,
    membership_id: UUID,
    user_name: str,
) -> None:
    payload = json.dumps({"membership_id": str(membership_id), "name": user_name})
    await redis_client.setex(
        _view_key(account_id, conversation_id, membership_id),
        VIEW_TTL_SECONDS,
        payload,
    )


async def clear_conversation_viewing(
    *,
    account_id: UUID,
    conversation_id: UUID,
    membership_id: UUID,
) -> None:
    await redis_client.delete(_view_key(account_id, conversation_id, membership_id))


async def set_conversation_typing(
    *,
    account_id: UUID,
    conversation_id: UUID,
    membership_id: UUID,
    user_name: str,
) -> None:
    payload = json.dumps({"membership_id": str(membership_id), "name": user_name})
    await redis_client.setex(
        _typing_key(account_id, conversation_id, membership_id),
        TYPING_TTL_SECONDS,
        payload,
    )


async def list_conversation_presence(
    *,
    account_id: UUID,
    conversation_id: UUID,
    exclude_membership_id: UUID | None = None,
) -> dict:
    viewers: list[dict] = []
    typing: list[dict] = []

    async for key in redis_client.scan_iter(match=f"watesly:inbox:view:{account_id}:{conversation_id}:*"):
        raw = await redis_client.get(key)
        if not raw:
            continue
        item = json.loads(raw)
        if exclude_membership_id and item.get("membership_id") == str(exclude_membership_id):
            continue
        viewers.append(item)

    async for key in redis_client.scan_iter(match=f"watesly:inbox:typing:{account_id}:{conversation_id}:*"):
        raw = await redis_client.get(key)
        if not raw:
            continue
        item = json.loads(raw)
        if exclude_membership_id and item.get("membership_id") == str(exclude_membership_id):
            continue
        typing.append(item)

    return {"viewers": viewers, "typing": typing}
