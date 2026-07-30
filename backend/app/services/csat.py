"""Customer satisfaction (CSAT) ratings."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.conversation_rating import ConversationRating


async def submit_conversation_rating(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
    score: int,
    comment: str | None = None,
    source: str = "agent",
) -> ConversationRating:
    if score < 1 or score > 5:
        raise ValueError("INVALID_SCORE")
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    existing = await db.execute(
        select(ConversationRating).where(ConversationRating.conversation_id == conversation_id)
    )
    rating = existing.scalar_one_or_none()
    if rating is None:
        rating = ConversationRating(
            account_id=account_id,
            conversation_id=conversation_id,
            contact_id=conversation.contact_id,
            score=score,
            comment=comment,
            source=source,
        )
        db.add(rating)
    else:
        rating.score = score
        rating.comment = comment
        rating.source = source
    await db.commit()
    await db.refresh(rating)
    return rating


async def csat_metrics(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    from datetime import UTC, datetime, timedelta

    since = datetime.now(UTC) - timedelta(days=days)
    rows = list(
        (
            await db.execute(
                select(ConversationRating).where(
                    ConversationRating.account_id == account_id,
                    ConversationRating.created_at >= since,
                )
            )
        ).scalars().all()
    )
    if not rows:
        return {
            "period_days": days,
            "total_ratings": 0,
            "average_score": None,
            "promoters_pct": None,
            "by_score": {str(i): 0 for i in range(1, 6)},
        }
    by_score = {str(i): 0 for i in range(1, 6)}
    total = 0
    for row in rows:
        by_score[str(row.score)] = by_score.get(str(row.score), 0) + 1
        total += row.score
    promoters = sum(1 for row in rows if row.score >= 4)
    return {
        "period_days": days,
        "total_ratings": len(rows),
        "average_score": round(total / len(rows), 2),
        "promoters_pct": round(promoters / len(rows) * 100, 1),
        "by_score": by_score,
    }
