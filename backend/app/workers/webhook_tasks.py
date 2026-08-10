import asyncio
from uuid import UUID

from celery.exceptions import MaxRetriesExceededError

from app.services.webhook_ingress import (
    MAX_WEBHOOK_ATTEMPTS,
    load_whatsapp_webhook_payload,
    mark_webhook_failed,
    mark_webhook_processed,
)
from app.services.whatsapp import WebhookProcessingError, store_and_process_webhook
from app.workers.async_runner import run_async
from app.workers.automation_tasks import execute_automation_run
from app.workers.celery_app import celery_app


async def _process(webhook_event_id: str) -> dict:
    from app.db.session import AsyncSessionFactory

    async with AsyncSessionFactory() as db:
        event, payload = await load_whatsapp_webhook_payload(db, UUID(webhook_event_id))
        try:
            result = await store_and_process_webhook(db, payload)
        except WebhookProcessingError:
            raise
        except Exception:
            await db.rollback()
            raise
        await mark_webhook_processed(db, event)
        return result


@celery_app.task(
    name="watesly.webhooks.process_whatsapp",
    queue="webhooks",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=MAX_WEBHOOK_ATTEMPTS - 1,
)
def process_whatsapp_webhook(self, webhook_event_id: str) -> dict:
    from app.db.session import AsyncSessionFactory

    try:
        result = run_async(_process(webhook_event_id))
    except Exception as exc:
        try:
            run_async(_mark_failed(webhook_event_id, str(exc), attempts=self.request.retries + 1))
        except Exception:
            pass
        if self.request.retries >= self.max_retries:
            run_async(_mark_failed(webhook_event_id, str(exc), attempts=MAX_WEBHOOK_ATTEMPTS, dead_letter=True))
            raise MaxRetriesExceededError(str(exc)) from exc
        raise

    run_ids = result.get("automation_run_ids", [])
    if isinstance(run_ids, list):
        for run_id in run_ids:
            execute_automation_run.apply_async(args=[str(run_id)], queue="automations")
    return result if isinstance(result, dict) else {"processed_count": result, "automation_run_ids": []}


async def _mark_failed(webhook_event_id: str, error: str, *, attempts: int, dead_letter: bool = False) -> None:
    from app.db.session import AsyncSessionFactory

    async with AsyncSessionFactory() as db:
        event, _ = await load_whatsapp_webhook_payload(db, UUID(webhook_event_id))
        await mark_webhook_failed(
            db,
            event,
            error=f"attempt:{attempts}:{error}",
            dead_letter=dead_letter or attempts >= MAX_WEBHOOK_ATTEMPTS,
        )
