"""Shopify / WooCommerce connections and order notification templates."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import encrypt_secret
from app.models.ecommerce_connection import EcommerceConnection
from app.models.order_message_template import OrderMessageTemplate
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.services.feature_flags import get_feature_flags

ALLOWED_PROVIDERS = {"shopify", "woocommerce"}
ORDER_EVENT_TYPES = {
    "order_created",
    "order_shipped",
    "order_delivered",
    "abandoned_cart",
    "payment_received",
}


def _provider_flag(provider: str) -> str:
    return "shopify_integration" if provider == "shopify" else "woocommerce_integration"


async def list_ecommerce_connections(db: AsyncSession, *, account_id: UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(EcommerceConnection)
            .where(EcommerceConnection.account_id == account_id)
            .order_by(EcommerceConnection.created_at.desc())
        )
    ).scalars().all()
    return [
        {
            "id": str(row.id),
            "provider": row.provider,
            "shop_label": row.shop_label,
            "shop_url": row.shop_url,
            "is_active": row.is_active,
            "settings": row.settings_json or {},
            "has_token": bool(row.access_token_encrypted),
        }
        for row in rows
    ]


async def create_ecommerce_connection(
    db: AsyncSession,
    *,
    account_id: UUID,
    provider: str,
    shop_label: str,
    shop_url: str,
    access_token: str | None = None,
    settings: dict | None = None,
) -> EcommerceConnection:
    provider = provider.lower().strip()
    if provider not in ALLOWED_PROVIDERS:
        raise ValueError("INVALID_PROVIDER")
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get(_provider_flag(provider)):
        raise ValueError("ECOMMERCE_PROVIDER_DISABLED")

    row = EcommerceConnection(
        account_id=account_id,
        provider=provider,
        shop_label=shop_label.strip()[:120],
        shop_url=shop_url.strip()[:500],
        access_token_encrypted=encrypt_secret(access_token) if access_token else None,
        settings_json=settings or {},
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def list_order_templates(db: AsyncSession, *, account_id: UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(OrderMessageTemplate)
            .where(OrderMessageTemplate.account_id == account_id)
            .order_by(OrderMessageTemplate.event_type.asc())
        )
    ).scalars().all()
    return [
        {
            "id": str(row.id),
            "event_type": row.event_type,
            "template_id": str(row.template_id),
            "whatsapp_account_id": str(row.whatsapp_account_id),
            "ecommerce_connection_id": str(row.ecommerce_connection_id) if row.ecommerce_connection_id else None,
            "is_active": row.is_active,
            "variable_mapping": row.variable_mapping or {},
        }
        for row in rows
    ]


async def upsert_order_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    event_type: str,
    template_id: UUID,
    whatsapp_account_id: UUID,
    ecommerce_connection_id: UUID | None = None,
    variable_mapping: dict | None = None,
    is_active: bool = True,
) -> OrderMessageTemplate:
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("order_templates"):
        raise ValueError("ORDER_TEMPLATES_DISABLED")
    if event_type not in ORDER_EVENT_TYPES:
        raise ValueError("INVALID_EVENT_TYPE")

    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("INVALID_TEMPLATE")
    if template.status != TemplateStatus.APPROVED:
        raise ValueError("TEMPLATE_NOT_APPROVED")

    existing = (
        await db.execute(
            select(OrderMessageTemplate).where(
                OrderMessageTemplate.account_id == account_id,
                OrderMessageTemplate.event_type == event_type,
                OrderMessageTemplate.ecommerce_connection_id == ecommerce_connection_id,
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.template_id = template_id
        existing.whatsapp_account_id = whatsapp_account_id
        existing.variable_mapping = variable_mapping or {}
        existing.is_active = is_active
        row = existing
    else:
        row = OrderMessageTemplate(
            account_id=account_id,
            ecommerce_connection_id=ecommerce_connection_id,
            event_type=event_type,
            template_id=template_id,
            whatsapp_account_id=whatsapp_account_id,
            variable_mapping=variable_mapping or {},
            is_active=is_active,
        )
        db.add(row)

    await db.commit()
    await db.refresh(row)
    return row


async def handle_ecommerce_webhook(
    db: AsyncSession,
    *,
    account_id: UUID,
    provider: str,
    event_type: str,
    payload: dict,
    send_message: bool = True,
) -> dict:
    """Resolve order template and optionally send WhatsApp template message."""
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get(_provider_flag(provider)) or not flags.get("order_templates"):
        return {"status": "skipped", "reason": "feature_disabled"}

    template_row = (
        await db.execute(
            select(OrderMessageTemplate).where(
                OrderMessageTemplate.account_id == account_id,
                OrderMessageTemplate.event_type == event_type,
                OrderMessageTemplate.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if template_row is None:
        return {"status": "skipped", "reason": "no_template_configured"}

    phone = str(payload.get("phone") or payload.get("customer_phone") or "").strip()
    if not phone:
        return {"status": "skipped", "reason": "missing_phone"}

    if not send_message:
        return {
            "status": "ready",
            "event_type": event_type,
            "template_id": str(template_row.template_id),
            "phone": phone,
        }

    from app.models.whatsapp_template import WhatsAppTemplate
    from app.schemas.whatsapp_media import SendTemplateMessageRequest
    from app.services.phone_normalize import normalize_whatsapp_phone
    from app.services.template_media import resolve_send_components
    from app.services.whatsapp import send_template_message

    template = await db.get(WhatsAppTemplate, template_row.template_id)
    if template is None or template.account_id != account_id:
        return {"status": "failed", "reason": "invalid_template"}

    mapping = template_row.variable_mapping or {}
    body_parameters: list[dict] = []
    if mapping:
        params = []
        for slot, field_key in sorted(mapping.items(), key=lambda item: str(item[0])):
            value = str(payload.get(str(field_key), "") or "")[:200]
            params.append({"type": "text", "text": value})
        if params:
            body_parameters = [{"type": "body", "parameters": params}]

    components = resolve_send_components(template.components, body_parameters or None)
    normalized = normalize_whatsapp_phone(phone)
    if not normalized:
        return {"status": "failed", "reason": "invalid_phone"}

    try:
        message = await send_template_message(
            db,
            account_id=account_id,
            whatsapp_account_id=template_row.whatsapp_account_id,
            payload=SendTemplateMessageRequest(
                to=normalized,
                template_name=template.name,
                language_code=template.language,
                components=components,
            ),
        )
        await db.commit()
        return {
            "status": "sent",
            "event_type": event_type,
            "message_id": str(message.id),
            "phone": normalized,
        }
    except ValueError as exc:
        return {"status": "failed", "reason": str(exc)[:200]}
