import hashlib
import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.models.marketplace_integration import MarketplaceIntegration
from app.models.webhook_delivery import WebhookDelivery
from app.models.webhook_subscription import WebhookSubscription
from app.services.webhook_dispatch import WEBHOOK_EVENTS, test_webhook_delivery

DEFAULT_SCOPES = [
    "contacts:read",
    "contacts:write",
    "messages:send",
    "campaigns:read",
    "crm:read",
    "crm:write",
]


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def serialize_api_key(item: ApiKey) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "key_prefix": item.key_prefix,
        "scopes": item.scopes or [],
        "last_used_at": item.last_used_at.isoformat() if item.last_used_at else None,
        "request_count": int(getattr(item, "request_count", 0) or 0),
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def serialize_webhook(item: WebhookSubscription) -> dict:
    return {
        "id": str(item.id),
        "url": item.url,
        "events": item.events or [],
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def serialize_delivery(item: WebhookDelivery) -> dict:
    return {
        "id": str(item.id),
        "subscription_id": str(item.subscription_id),
        "event_type": item.event_type,
        "status": item.status,
        "response_code": item.response_code,
        "error_message": item.error_message,
        "duration_ms": item.duration_ms,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


async def create_api_key(db: AsyncSession, *, account_id: UUID, name: str, scopes: list[str] | None = None) -> tuple[ApiKey, str]:
    raw = f"mw_{secrets.token_urlsafe(32)}"
    prefix = raw[:8]
    item = ApiKey(
        account_id=account_id,
        name=name,
        key_prefix=prefix,
        key_hash=_hash_key(raw),
        scopes=scopes or DEFAULT_SCOPES,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item, raw


async def list_api_keys(db: AsyncSession, account_id: UUID) -> list[dict]:
    result = await db.execute(
        select(ApiKey).where(ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None)).order_by(ApiKey.created_at.desc())
    )
    return [serialize_api_key(item) for item in result.scalars().all()]


async def revoke_api_key(db: AsyncSession, *, account_id: UUID, key_id: UUID) -> None:
    item = await db.get(ApiKey, key_id)
    if item is None or item.account_id != account_id:
        raise ValueError("API_KEY_NOT_FOUND")
    item.revoked_at = datetime.now(UTC)
    await db.commit()


async def create_webhook_subscription(
    db: AsyncSession, *, account_id: UUID, url: str, events: list[str]
) -> tuple[WebhookSubscription, str]:
    secret = secrets.token_urlsafe(24)
    item = WebhookSubscription(account_id=account_id, url=url, events=events or ["message.received"], secret=secret)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item, secret


async def list_webhook_subscriptions(db: AsyncSession, account_id: UUID) -> list[dict]:
    result = await db.execute(
        select(WebhookSubscription).where(WebhookSubscription.account_id == account_id).order_by(WebhookSubscription.created_at.desc())
    )
    return [serialize_webhook(item) for item in result.scalars().all()]


async def delete_webhook_subscription(db: AsyncSession, *, account_id: UUID, webhook_id: UUID) -> None:
    item = await db.get(WebhookSubscription, webhook_id)
    if item is None or item.account_id != account_id:
        raise ValueError("WEBHOOK_NOT_FOUND")
    await db.delete(item)
    await db.commit()


async def toggle_webhook_subscription(db: AsyncSession, *, account_id: UUID, webhook_id: UUID, is_active: bool) -> dict:
    item = await db.get(WebhookSubscription, webhook_id)
    if item is None or item.account_id != account_id:
        raise ValueError("WEBHOOK_NOT_FOUND")
    item.is_active = is_active
    await db.commit()
    await db.refresh(item)
    return serialize_webhook(item)


async def list_webhook_deliveries(db: AsyncSession, *, account_id: UUID, limit: int = 50) -> list[dict]:
    result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.account_id == account_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(limit)
    )
    return [serialize_delivery(item) for item in result.scalars().all()]


async def developer_overview(db: AsyncSession, *, account_id: UUID) -> dict:
    keys = int(
        (await db.scalar(
            select(func.count(ApiKey.id)).where(ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None))
        ))
        or 0
    )
    webhooks = int(
        (await db.scalar(select(func.count(WebhookSubscription.id)).where(WebhookSubscription.account_id == account_id)))
        or 0
    )
    deliveries_24h = int(
        (await db.scalar(
            select(func.count(WebhookDelivery.id)).where(
                WebhookDelivery.account_id == account_id,
                WebhookDelivery.created_at >= datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0),
            )
        ))
        or 0
    )
    total_requests = int(
        (await db.scalar(
            select(func.coalesce(func.sum(ApiKey.request_count), 0)).where(
                ApiKey.account_id == account_id, ApiKey.revoked_at.is_(None)
            )
        ))
        or 0
    )
    return {
        "api_keys": keys,
        "webhooks": webhooks,
        "deliveries_today": deliveries_24h,
        "total_api_requests": total_requests,
        "rate_limit_per_minute": 100,
        "external_base_url": "/api/v1/external",
        "webhook_events": WEBHOOK_EVENTS,
    }


def developer_docs() -> dict:
    return {
        "authentication": "Authorization: Bearer mw_...",
        "base_url": "/api/v1/external",
        "endpoints": [
            {"method": "GET", "path": "/external/me", "scope": "contacts:read"},
            {"method": "GET", "path": "/external/contacts", "scope": "contacts:read"},
            {"method": "POST", "path": "/external/contacts", "scope": "contacts:write"},
            {"method": "POST", "path": "/external/conversations/{id}/messages", "scope": "messages:send"},
            {"method": "GET", "path": "/external/campaigns", "scope": "campaigns:read"},
            {"method": "GET", "path": "/external/crm/deals", "scope": "crm:read"},
            {"method": "POST", "path": "/external/crm/deals", "scope": "crm:write"},
        ],
        "webhook_signature": "HMAC SHA256 in X-Watesly-Signature header",
        "openapi": "/docs",
    }


async def ensure_marketplace_catalog(db: AsyncSession) -> None:
    catalog = [
        ("zapier", "Zapier", "automation", "Connect Watesly to 5000+ apps"),
        ("slack", "Slack", "notifications", "Team notifications and alerts"),
        ("hubspot", "HubSpot", "crm", "Sync contacts and deals"),
        ("shopify", "Shopify", "ecommerce", "Order notifications via WhatsApp"),
        ("stripe", "Stripe", "billing", "Payment and subscription events"),
        ("google-sheets", "Google Sheets", "data", "Export contacts and reports"),
    ]
    for slug, name, category, description in catalog:
        existing = (
            await db.execute(select(MarketplaceIntegration).where(MarketplaceIntegration.slug == slug))
        ).scalar_one_or_none()
        if existing is None:
            db.add(MarketplaceIntegration(slug=slug, name=name, category=category, description=description))
    await db.commit()


async def list_marketplace(db: AsyncSession) -> list[dict]:
    await ensure_marketplace_catalog(db)
    result = await db.execute(select(MarketplaceIntegration).order_by(MarketplaceIntegration.name.asc()))
    return [
        {
            "id": str(item.id),
            "slug": item.slug,
            "name": item.name,
            "category": item.category,
            "description": item.description,
            "status": item.status,
        }
        for item in result.scalars().all()
    ]


async def run_webhook_test(db: AsyncSession, *, account_id: UUID, webhook_id: UUID) -> dict:
    delivery = await test_webhook_delivery(db, account_id=account_id, subscription_id=webhook_id)
    return serialize_delivery(delivery)
