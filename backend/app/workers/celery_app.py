from celery import Celery
from celery.signals import worker_process_init

from app.core.config import settings

celery_app = Celery(
    "watesly",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.workers.automation_tasks",
        "app.workers.campaign_tasks",
        "app.workers.growth_tasks",
        "app.workers.scheduler_tasks",
        "app.workers.outbox_tasks",
        "app.workers.heartbeat_tasks",
        "app.workers.webhook_tasks",
        "app.workers.whatsapp_health_tasks",
        "app.workers.sla_tasks",
        "app.workers.template_sync_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "watesly.webhooks.*": {"queue": "webhooks"},
        "watesly.campaigns.*": {"queue": "campaigns"},
        "watesly.automations.*": {"queue": "automations"},
    },
)

import app.services.event_handlers  # noqa: F401,E402


@worker_process_init.connect
def _reset_db_engine_after_fork(**_kwargs) -> None:
    """Avoid asyncpg 'Future attached to a different loop' in Celery fork workers."""
    from app.db.session import engine

    engine.sync_engine.dispose(close=False)

celery_app.conf.beat_schedule = {
    "publish-outbox-every-5-seconds": {"task": "watesly.outbox.publish", "schedule": 5.0},
    "worker-heartbeat-every-30-seconds": {"task": "watesly.health.worker_heartbeat", "schedule": 30.0},
    "run-due-jobs-every-minute": {
        "task": "watesly.scheduler.run_due_jobs",
        "schedule": 60.0,
    },
    "sync-whatsapp-health-hourly": {
        "task": "watesly.whatsapp.sync_health",
        "schedule": 3600.0,
    },
    "check-sla-breaches-every-2-minutes": {
        "task": "watesly.sla.check_breaches",
        "schedule": 120.0,
    },
    "sync-pending-templates-every-5-minutes": {
        "task": "watesly.templates.sync_pending",
        "schedule": 300.0,
    },
}
