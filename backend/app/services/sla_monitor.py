"""SLA monitoring for open conversations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation, ConversationStatus
from app.services.notifications import create_notification

DEFAULT_SLA_MINUTES = 15


async def set_sla_deadline_on_inbound(
    db: AsyncSession,
    *,
    conversation: Conversation,
    sla_minutes: int = DEFAULT_SLA_MINUTES,
) -> None:
    if conversation.status != ConversationStatus.OPEN:
        return
    conversation.sla_deadline_at = datetime.now(UTC) + timedelta(minutes=max(1, sla_minutes))
    conversation.sla_breached_at = None


async def check_sla_breaches(db: AsyncSession, *, account_id: UUID | None = None) -> int:
    now = datetime.now(UTC)
    query = select(Conversation).where(
        Conversation.deleted_at.is_(None),
        Conversation.status.in_([ConversationStatus.OPEN, ConversationStatus.PENDING]),
        Conversation.sla_deadline_at.is_not(None),
        Conversation.sla_deadline_at < now,
        Conversation.sla_breached_at.is_(None),
    )
    if account_id:
        query = query.where(Conversation.account_id == account_id)
    conversations = list((await db.execute(query.limit(200))).scalars().all())
    for conversation in conversations:
        conversation.sla_breached_at = now
        await create_notification(
            db,
            account_id=conversation.account_id,
            user_id=None,
            type="sla_breach",
            title="تأخر الرد على محادثة",
            body="محادثة تجاوزت وقت SLA — يرجى المتابعة.",
            data={"conversation_id": str(conversation.id)},
        )
    if conversations:
        await db.commit()
    return len(conversations)
