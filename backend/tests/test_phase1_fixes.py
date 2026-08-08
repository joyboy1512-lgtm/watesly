from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_campaign_recipient_status_is_updated_from_webhook_handler() -> None:
    source = read("app/services/whatsapp.py")
    assert "CampaignRecipient.external_message_id == external_id" in source
    assert "recipient.status = CampaignRecipientStatus(status_value)" in source


def test_automation_triggers_are_wired_for_inbound_messages() -> None:
    whatsapp = read("app/services/whatsapp.py")
    inbound = read("app/services/inbound_whatsapp.py")
    triggers = read("app/services/automation_triggers.py")
    assert "process_inbound_side_effects" in whatsapp
    assert "queue_automation_runs" in inbound
    assert "AutomationTriggerType.MESSAGE_RECEIVED" in inbound
    assert "AutomationStatus.ACTIVE" in triggers


def test_webhooks_are_processed_asynchronously() -> None:
    route = read("app/api/routes/whatsapp.py")
    tasks = read("app/workers/webhook_tasks.py")
    assert "process_whatsapp_webhook.delay(payload)" in route
    assert "watesly.webhooks.process_whatsapp" in tasks
    assert "run_async(_process(payload))" in tasks


def test_webhook_worker_resets_async_pools() -> None:
    runner = read("app/workers/async_runner.py")
    assert "await engine.dispose()" in runner
    assert "dispose_redis_client" in runner


def test_automation_run_queued_dispatches_worker() -> None:
    handlers = read("app/services/event_handlers.py")
    webhook = read("app/workers/webhook_tasks.py")
    assert "automation.run_queued" in handlers
    assert 'queue="automations"' in handlers
    assert "execute_automation_run.apply_async" in webhook


def test_super_admin_with_membership_uses_role_permissions() -> None:
    source = read("app/api/dependencies/auth.py")
    assert "isinstance(context.membership, Membership)" in source
    assert "SUPPORT_ACCESS_REQUIRED" in source
