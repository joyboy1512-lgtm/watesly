from __future__ import annotations

import hashlib
import hmac
import json
import time
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.webhook_delivery import WebhookDelivery
from app.models.webhook_subscription import WebhookSubscription

WEBHOOK_EVENTS = [
    "message.received",
    "message.sent",
    "conversation.created",
    "conversation.closed",
    "contact.created",
    "deal.created",
    "deal.won",
    "campaign.completed",
]

SIGNATURE_HEADER = "X-Watesly-Signature"
EVENT_HEADER = "X-Watesly-Event"


def sign_payload(secret: str, body: bytes) -> str:
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


async def dispatch_account_webhook(
    db: AsyncSession,
    *,
    account_id: UUID,
    event_type: str,
    payload: dict,
) -> int:
    subscriptions = list(
        (
            await db.execute(
                select(WebhookSubscription).where(
                    WebhookSubscription.account_id == account_id,
                    WebhookSubscription.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    sent = 0
    for sub in subscriptions:
        events = sub.events or []
        if events and event_type not in events:
            continue
        ok = await _deliver(db, subscription=sub, event_type=event_type, payload=payload)
        if ok:
            sent += 1
    return sent


async def _deliver(
    db: AsyncSession,
    *,
    subscription: WebhookSubscription,
    event_type: str,
    payload: dict,
) -> bool:
    delivery = WebhookDelivery(
        account_id=subscription.account_id,
        subscription_id=subscription.id,
        event_type=event_type,
        payload={"event": event_type, "data": payload},
        status="pending",
    )
    db.add(delivery)
    await db.flush()
    envelope = {
        "id": str(delivery.id),
        "event": event_type,
        "created_at": payload.get("created_at"),
        "data": payload,
    }
    body = json.dumps(envelope, default=str).encode()
    signature = sign_payload(subscription.secret, body)
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                subscription.url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    SIGNATURE_HEADER: signature,
                    EVENT_HEADER: event_type,
                    "User-Agent": "Watesly-Webhooks/1.0",
                },
            )
        delivery.response_code = response.status_code
        delivery.duration_ms = int((time.perf_counter() - started) * 1000)
        if 200 <= response.status_code < 300:
            delivery.status = "success"
            await db.commit()
            return True
        delivery.status = "failed"
        delivery.error_message = response.text[:500]
        await db.commit()
        return False
    except Exception as exc:
        delivery.status = "failed"
        delivery.error_message = str(exc)[:500]
        delivery.duration_ms = int((time.perf_counter() - started) * 1000)
        await db.commit()
        return False


async def test_webhook_delivery(
    db: AsyncSession,
    *,
    account_id: UUID,
    subscription_id: UUID,
) -> WebhookDelivery:
    sub = await db.get(WebhookSubscription, subscription_id)
    if sub is None or sub.account_id != account_id:
        raise ValueError("WEBHOOK_NOT_FOUND")
    await _deliver(
        db,
        subscription=sub,
        event_type="webhook.test",
        payload={"message": "Watesly test event", "account_id": str(account_id)},
    )
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.subscription_id == subscription_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(1)
    )
    delivery = result.scalar_one()
    return delivery
