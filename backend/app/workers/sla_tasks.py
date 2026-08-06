import asyncio

from app.db.session import AsyncSessionFactory
from app.services.sla_monitor import check_sla_breaches
from app.workers.celery_app import celery_app


async def _check_all() -> dict:
    async with AsyncSessionFactory() as db:
        breached = await check_sla_breaches(db)
        return {"breached": breached}


@celery_app.task(name="watesly.sla.check_breaches")
def check_sla_breaches_task() -> dict:
    return asyncio.run(_check_all())
