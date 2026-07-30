"""Register domain event handlers for side effects."""

from app.core_engine.events import DomainEvent, event_bus


def _run_id_from_event(event: DomainEvent) -> str | None:
    run_id = event.payload.get("run_id")
    if run_id:
        return str(run_id)
    if event.aggregate_type == "automation_run" and event.aggregate_id:
        return str(event.aggregate_id)
    return None


async def _on_automation_run_queued(event: DomainEvent) -> None:
    run_id = _run_id_from_event(event)
    if run_id:
        from app.workers.automation_tasks import execute_automation_run

        execute_automation_run.apply_async(args=[run_id], queue="automations")


async def _on_whatsapp_message(event: DomainEvent) -> None:
    _ = event.account_id


def register_event_handlers() -> None:
    event_bus.subscribe("automation.run_queued", _on_automation_run_queued)
    event_bus.subscribe("whatsapp.message", _on_whatsapp_message)


register_event_handlers()
