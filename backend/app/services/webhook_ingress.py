"""Durable WhatsApp webhook ingress: persist before async processing."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook_event import WebhookEvent, WebhookEventStatus

MAX_WEBHOOK_ATTEMPTS = 5


def _ingress_meta(payload: dict) -> dict:
    existing = payload.get("_ingress")
    if isinstance(existing, dict):
        return dict(existing)
    return {"attempts": 0, "max_attempts": MAX_WEBHOOK_ATTEMPTS}


def _external_event_key(payload: dict) -> str | None:
    entries = payload.get("entry") or []
    if not entries:
        return None
    entry = entries[0] if isinstance(entries[0], dict) else {}
    entry_id = entry.get("id")
    changes = entry.get("changes") or []
    field = changes[0].get("field") if changes and isinstance(changes[0], dict) else None
    if not entry_id:
        return None
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:32]
    return f"meta_whatsapp:{entry_id}:{field or 'batch'}:{digest}"


async def persist_whatsapp_webhook(db: AsyncSession, payload: dict) -> UUID:
    """Store webhook payload durably before Celery processing."""
    external_key = _external_event_key(payload)
    if external_key:
        existing = await db.execute(
            select(WebhookEvent.id).where(
                WebhookEvent.provider == "meta_whatsapp",
                WebhookEvent.external_event_key == external_key,
                WebhookEvent.status.in_(
                    [WebhookEventStatus.RECEIVED, WebhookEventStatus.PROCESSED]
                ),
            )
        )
        found = existing.scalar_one_or_none()
        if found is not None:
            return found

    wrapped = {"body": payload, "_ingress": _ingress_meta(payload)}
    event = WebhookEvent(
        provider="meta_whatsapp",
        external_event_key=external_key,
        event_type="whatsapp_webhook_batch",
        payload=wrapped,
        status=WebhookEventStatus.RECEIVED,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event.id


async def load_whatsapp_webhook_payload(db: AsyncSession, webhook_event_id: UUID) -> tuple[WebhookEvent, dict]:
    event = await db.get(WebhookEvent, webhook_event_id)
    if event is None:
        raise ValueError("WEBHOOK_EVENT_NOT_FOUND")
    stored = event.payload if isinstance(event.payload, dict) else {}
    body = stored.get("body")
    if not isinstance(body, dict):
        body = stored
    return event, body


async def mark_webhook_processed(db: AsyncSession, event: WebhookEvent) -> None:
    event.status = WebhookEventStatus.PROCESSED
    event.processed_at = datetime.now(UTC)
    event.error_message = None
    await db.commit()


async def mark_webhook_failed(
    db: AsyncSession,
    event: WebhookEvent,
    *,
    error: str,
    dead_letter: bool,
) -> None:
    stored = event.payload if isinstance(event.payload, dict) else {}
    ingress = _ingress_meta(stored)
    ingress["attempts"] = int(ingress.get("attempts", 0)) + 1
    ingress["last_failed_at"] = datetime.now(UTC).isoformat()
    if isinstance(stored, dict):
        stored["_ingress"] = ingress
        event.payload = stored
    event.error_message = error[:4000]
    event.status = WebhookEventStatus.FAILED if dead_letter else WebhookEventStatus.RECEIVED
    if dead_letter:
        event.processed_at = datetime.now(UTC)
    await db.commit()


async def list_retryable_webhook_events(db: AsyncSession, *, limit: int = 20) -> list[WebhookEvent]:
    result = await db.execute(
        select(WebhookEvent)
        .where(
            WebhookEvent.provider == "meta_whatsapp",
            WebhookEvent.status == WebhookEventStatus.FAILED,
        )
        .order_by(WebhookEvent.updated_at.asc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    retryable: list[WebhookEvent] = []
    for event in rows:
        stored = event.payload if isinstance(event.payload, dict) else {}
        ingress = _ingress_meta(stored)
        if int(ingress.get("attempts", 0)) >= int(ingress.get("max_attempts", MAX_WEBHOOK_ATTEMPTS)):
            continue
        retryable.append(event)
    return retryable
