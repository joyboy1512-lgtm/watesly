"""Account-level feature flags for safe rollout."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account

DEFAULT_FLAGS = {
    "ai_agent_auto_reply": True,
    "sla_monitoring": True,
    "privacy_mask_agents": True,
    "instagram_channel": False,
    "messenger_channel": False,
    "marketplace_installs": True,
    "http_automation_requests": True,
}


async def get_feature_flags(db: AsyncSession, *, account_id: UUID) -> dict:
    account = await db.get(Account, account_id)
    if account is None:
        return dict(DEFAULT_FLAGS)
    stored = account.feature_flags if isinstance(account.feature_flags, dict) else {}
    merged = dict(DEFAULT_FLAGS)
    merged.update(stored)
    return merged


async def update_feature_flags(
    db: AsyncSession,
    *,
    account_id: UUID,
    updates: dict,
) -> dict:
    account = await db.get(Account, account_id)
    if account is None:
        raise ValueError("ACCOUNT_NOT_FOUND")
    current = dict(account.feature_flags or {})
    current.update({key: value for key, value in updates.items() if key in DEFAULT_FLAGS})
    account.feature_flags = current
    await db.commit()
    await db.refresh(account)
    merged = dict(DEFAULT_FLAGS)
    merged.update(current)
    return merged
