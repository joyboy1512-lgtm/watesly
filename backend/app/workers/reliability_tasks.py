import asyncio

from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app


async def _recover_stuck_campaigns() -> dict:
    from app.services.campaign_recovery import recover_stuck_campaigns

    return await recover_stuck_campaigns()


async def _retry_failed_webhooks() -> dict:
    from app.services.webhook_ingress import list_retryable_webhook_events
    from app.db.session import AsyncSessionFactory
    from app.workers.webhook_tasks import process_whatsapp_webhook

    async with AsyncSessionFactory() as db:
        events = await list_retryable_webhook_events(db, limit=25)
    queued = 0
    for event in events:
        process_whatsapp_webhook.delay(str(event.id))
        queued += 1
    return {"queued": queued}


async def _retry_failed_inbound_media() -> dict:
    from app.services.inbound_media_retry import retry_failed_inbound_media

    return await retry_failed_inbound_media(limit=25)


@celery_app.task(name="watesly.reliability.recover_stuck_campaigns")
def recover_stuck_campaigns_task() -> dict:
    return run_async(_recover_stuck_campaigns())


@celery_app.task(name="watesly.reliability.retry_failed_webhooks")
def retry_failed_webhooks_task() -> dict:
    return run_async(_retry_failed_webhooks())


@celery_app.task(name="watesly.reliability.retry_failed_inbound_media")
def retry_failed_inbound_media_task() -> dict:
    return run_async(_retry_failed_inbound_media())
