import asyncio
import socket
from datetime import UTC, datetime

from app.core_engine.events import DomainEvent, event_bus
from app.db.session import AsyncSessionFactory
from app.models.outbox_event import OutboxStatus
from app.services.outbox import claim_outbox_events, next_retry
from app.workers.celery_app import celery_app


async def _publish() -> dict:
    async with AsyncSessionFactory() as db:
        events = await claim_outbox_events(db, worker_id=socket.gethostname())
        published = failed = 0
        for item in events:
            try:
                await event_bus.publish(DomainEvent(name=item.event_type, account_id=item.account_id, payload=item.payload, aggregate_type=item.aggregate_type, aggregate_id=item.aggregate_id, event_id=item.id))
                item.status = OutboxStatus.PUBLISHED
                item.processed_at = datetime.now(UTC)
                item.last_error = None
                item.lock_owner = None
                item.locked_at = None
                published += 1
            except Exception as exc:
                item.status = OutboxStatus.DEAD if item.attempts >= item.max_attempts else OutboxStatus.FAILED
                item.lock_owner = None
                item.locked_at = None
                item.last_error = str(exc)[:2000]
                item.available_at = next_retry(item.attempts)
                failed += 1
            await db.commit()
        return {"claimed": len(events), "published": published, "failed": failed}


@celery_app.task(name="watesly.outbox.publish")
def publish_outbox_events() -> dict:
    return asyncio.run(_publish())
