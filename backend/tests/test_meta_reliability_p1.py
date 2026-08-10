from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_webhook_is_persisted_before_async_processing() -> None:
    route = read("app/api/routes/whatsapp.py")
    ingress = read("app/services/webhook_ingress.py")
    tasks = read("app/workers/webhook_tasks.py")
    assert "persist_whatsapp_webhook" in route
    assert "process_whatsapp_webhook.delay(str(webhook_event_id))" in route
    assert "async def persist_whatsapp_webhook" in ingress
    assert "autoretry_for=(Exception,)" in tasks
    assert "mark_webhook_failed" in tasks


def test_outbound_messages_commit_queued_before_meta() -> None:
    source = read("app/services/whatsapp.py")
    assert "status=MessageStatus.QUEUED" in source
    assert "message.external_message_id and message.status == MessageStatus.SENT" in source


def test_campaign_start_enforces_tier_limit() -> None:
    campaigns = read("app/services/campaigns.py")
    window = read("app/services/whatsapp_window.py")
    assert "enforce_campaign_tier_limit" in campaigns
    assert "TIER_LIMIT_EXCEEDED" in window


def test_campaign_worker_handles_meta_rate_limits() -> None:
    worker = read("app/workers/campaign_tasks.py")
    assert "is_transient_meta_error" in worker
    assert "sleep_for_meta_backoff" in worker
    assert "recipient.external_message_id" in worker


def test_campaign_recovery_endpoints_and_scheduler_exist() -> None:
    routes = read("app/api/routes/campaigns.py")
    recovery = read("app/services/campaign_recovery.py")
    celery = read("app/workers/celery_app.py")
    assert "/retry-failed" in routes
    assert "recover_stuck_campaigns" in recovery
    assert "watesly.reliability.recover_stuck_campaigns" in celery


def test_realtime_delivery_status_events_are_published() -> None:
    source = read("app/services/whatsapp.py")
    reliability = read("app/services/meta_reliability.py")
    assert "delivery_status_event" in source
    assert "message.status_updated" in reliability


def test_external_api_uses_whatsapp_window_module() -> None:
    source = read("app/api/routes/external.py")
    assert "app.services.whatsapp_window import compute_service_window" in source
    assert "app.services.service_window" not in source


def test_meta_client_supports_read_receipts_and_template_delete() -> None:
    source = read("app/services/meta_client.py")
    assert "mark_message_read" in source
    assert "delete_message_template" in source
    assert "list_all_templates" in source
