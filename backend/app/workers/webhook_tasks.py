import asyncio

from app.services.whatsapp import store_and_process_webhook
from app.workers.async_runner import run_async
from app.workers.automation_tasks import execute_automation_run
from app.workers.celery_app import celery_app


async def _process(payload: dict) -> dict:
    from app.db.session import AsyncSessionFactory

    async with AsyncSessionFactory() as db:
        return await store_and_process_webhook(db, payload)


@celery_app.task(name="watesly.webhooks.process_whatsapp", queue="webhooks")
def process_whatsapp_webhook(payload: dict) -> dict:
    result = run_async(_process(payload))
    run_ids = result.get("automation_run_ids", [])
    if isinstance(run_ids, list):
        for run_id in run_ids:
            execute_automation_run.apply_async(args=[str(run_id)], queue="automations")
    return result if isinstance(result, dict) else {"processed_count": result, "automation_run_ids": []}
