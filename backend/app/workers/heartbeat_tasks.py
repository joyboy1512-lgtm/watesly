import asyncio
import os
import socket

from app.db.session import AsyncSessionFactory
from app.models.module_health import ModuleHealthStatus
from app.services.health_center import heartbeat
from app.workers.celery_app import celery_app


async def _heartbeat() -> dict:
    async with AsyncSessionFactory() as db:
        item = await heartbeat(db, module_name="worker", instance_id=f"{socket.gethostname()}:{os.getpid()}", status=ModuleHealthStatus.HEALTHY, details={"queue": "celery"})
        return {"id": str(item.id), "status": item.status}


@celery_app.task(name="watesly.health.worker_heartbeat")
def worker_heartbeat() -> dict:
    return asyncio.run(_heartbeat())
