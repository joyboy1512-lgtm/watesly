from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduled_job import ScheduledJob, ScheduledJobStatus


async def schedule_job(
    db: AsyncSession,
    *,
    account_id: UUID,
    job_type: str,
    payload: dict,
    run_at: datetime,
    max_attempts: int = 5,
) -> ScheduledJob:
    item = ScheduledJob(
        account_id=account_id,
        job_type=job_type,
        payload=payload,
        run_at=run_at,
        max_attempts=max_attempts,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def claim_due_jobs(
    db: AsyncSession,
    *,
    limit: int = 100,
) -> list[ScheduledJob]:
    now = datetime.now(UTC)
    result = await db.execute(
        select(ScheduledJob)
        .where(
            ScheduledJob.status == ScheduledJobStatus.PENDING,
            ScheduledJob.run_at <= now,
        )
        .with_for_update(skip_locked=True)
        .limit(limit)
    )
    jobs = list(result.scalars().all())
    for item in jobs:
        item.status = ScheduledJobStatus.CLAIMED
        item.locked_at = now
        item.attempts += 1
    await db.commit()
    return jobs
