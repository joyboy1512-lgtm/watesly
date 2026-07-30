from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.outbox_event import OutboxEvent, OutboxStatus


async def add_outbox_event(db: AsyncSession, *, account_id: UUID, event_type: str, aggregate_type: str, aggregate_id: str, payload: dict) -> OutboxEvent:
    event = OutboxEvent(account_id=account_id, event_type=event_type, aggregate_type=aggregate_type, aggregate_id=aggregate_id, payload=payload, status=OutboxStatus.PENDING, available_at=datetime.now(UTC))
    db.add(event)
    await db.flush()
    return event


async def reclaim_stale_events(db: AsyncSession, *, stale_after_seconds: int = 120) -> int:
    cutoff = datetime.now(UTC) - timedelta(seconds=stale_after_seconds)
    result = await db.execute(
        update(OutboxEvent)
        .where(OutboxEvent.status == OutboxStatus.PROCESSING, OutboxEvent.locked_at < cutoff)
        .values(status=OutboxStatus.FAILED, lock_owner=None, locked_at=None, last_error="stale processing lock reclaimed")
    )
    await db.commit()
    return int(result.rowcount or 0)


async def claim_outbox_events(db: AsyncSession, *, worker_id: str, limit: int = 100) -> list[OutboxEvent]:
    await reclaim_stale_events(db)
    now = datetime.now(UTC)
    result = await db.execute(
        select(OutboxEvent)
        .where(OutboxEvent.status.in_([OutboxStatus.PENDING, OutboxStatus.FAILED]), OutboxEvent.available_at <= now, OutboxEvent.attempts < OutboxEvent.max_attempts)
        .order_by(OutboxEvent.created_at)
        .with_for_update(skip_locked=True)
        .limit(limit)
    )
    events = list(result.scalars().all())
    for event in events:
        event.status = OutboxStatus.PROCESSING
        event.locked_at = now
        event.lock_owner = worker_id
        event.attempts += 1
    await db.commit()
    return events


def next_retry(attempts: int) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=min(300, 2 ** min(attempts, 8)))
