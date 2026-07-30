import asyncio
from datetime import UTC, datetime
from uuid import UUID

from app.db.session import AsyncSessionFactory
from app.models.scheduled_job import ScheduledJobStatus
from app.services.scheduler import claim_due_jobs
from app.workers.campaign_tasks import run_campaign
from app.workers.celery_app import celery_app


async def _handle_job(db, job) -> None:
    if job.job_type == "campaign.start":
        campaign_id = job.payload.get("campaign_id")
        execution_token = job.payload.get("execution_token")
        if campaign_id and execution_token:
            run_campaign.apply_async(args=[campaign_id, execution_token], queue="campaigns")
    elif job.job_type == "conversation.unsnooze":
        from app.models.conversation import Conversation

        conversation_id = job.payload.get("conversation_id")
        if conversation_id:
            conversation = await db.get(Conversation, UUID(str(conversation_id)))
            if conversation:
                conversation.snoozed_until = None
    elif job.job_type == "automation.resume":
        from app.workers.automation_tasks import execute_automation_run

        run_id = job.payload.get("run_id")
        if run_id:
            execute_automation_run.apply_async(args=[str(run_id)], queue="automations")
    else:
        job.error_message = f"Unknown job type: {job.job_type}"


async def _run_due_jobs() -> dict:
    async with AsyncSessionFactory() as db:
        jobs = await claim_due_jobs(db, limit=100)
        completed = failed = 0
        for job in jobs:
            try:
                await _handle_job(db, job)
                job.status = ScheduledJobStatus.COMPLETED
                job.completed_at = datetime.now(UTC)
                completed += 1
            except Exception as exc:
                job.error_message = str(exc)
                if job.attempts >= job.max_attempts:
                    job.status = ScheduledJobStatus.FAILED
                else:
                    job.status = ScheduledJobStatus.PENDING
                failed += 1
            await db.commit()
        return {"claimed": len(jobs), "completed": completed, "failed": failed}


@celery_app.task(name="watesly.scheduler.run_due_jobs")
def run_due_jobs() -> dict:
    return asyncio.run(_run_due_jobs())
