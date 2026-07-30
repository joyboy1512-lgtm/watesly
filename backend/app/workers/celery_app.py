from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "watesly",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.workers.automation_tasks",
        "app.workers.campaign_tasks",
        "app.workers.scheduler_tasks",
        "app.workers.outbox_tasks",
        "app.workers.heartbeat_tasks",
        "app.workers.webhook_tasks",
        "app.workers.whatsapp_health_tasks",
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
}
