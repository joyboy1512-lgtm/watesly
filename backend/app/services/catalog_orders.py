"""Catalog order listing, persistence, and invoice helpers."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account
from app.models.catalog_order import CatalogOrder, CatalogOrderStatus
from app.models.contact import Contact
from app.models.message import Message, MessageType
from app.models.organization import Organization
from app.services.inbound_commerce import order_total_amount, resolve_order_product_names

logger = logging.getLogger(__name__)


def build_line_items(
    order_data: dict[str, Any],
    *,
    product_names: dict[str, str],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for raw in order_data.get("product_items") or []:
        retailer_id = str(raw.get("product_retailer_id") or "").strip()
        if not retailer_id:
            continue
        quantity = max(int(raw.get("quantity") or 1), 1)
        currency = str(raw.get("currency") or order_data.get("currency") or "KWD")
        unit_price = raw.get("item_price")
        line_total: Decimal | None = None
        if unit_price is not None:
            line_total = Decimal(str(unit_price)) * Decimal(str(quantity))
        items.append(
            {
                "product_retailer_id": retailer_id,
                "product_name": product_names.get(retailer_id) or retailer_id,
                "quantity": quantity,
                "unit_price": str(unit_price) if unit_price is not None else None,
                "currency": currency,
                "line_total": f"{line_total:.2f}" if line_total is not None else None,
            }
        )
    return items


async def _next_order_number(db: AsyncSession, *, account_id: UUID) -> str:
    today = datetime.now(UTC).strftime("%Y%m%d")
    prefix = f"ORD-{today}-"
    count = (
        await db.scalar(
            select(func.count())
            .select_from(CatalogOrder)
            .where(
                CatalogOrder.account_id == account_id,
                CatalogOrder.order_number.like(f"{prefix}%"),
            )
        )
        or 0
    )
    return f"{prefix}{count + 1:04d}"


async def create_catalog_order(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    channel_id: UUID,
    contact_id: UUID,
    conversation_id: UUID | None,
    message_id: UUID,
    deal_id: UUID | None,
    order_data: dict[str, Any],
    product_names: dict[str, str] | None = None,
) -> CatalogOrder:
    existing = (
        await db.execute(select(CatalogOrder).where(CatalogOrder.message_id == message_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    if product_names is None:
        product_names = await resolve_order_product_names(
            db,
            account_id=account_id,
            product_items=order_data.get("product_items") or [],
        )
    subtotal, currency = order_total_amount(order_data)
    order = CatalogOrder(
        account_id=account_id,
        organization_id=organization_id,
        channel_id=channel_id,
        contact_id=contact_id,
        conversation_id=conversation_id,
        message_id=message_id,
        deal_id=deal_id,
        order_number=await _next_order_number(db, account_id=account_id),
        meta_catalog_id=str(order_data.get("catalog_id") or "").strip() or None,
        customer_note=str(order_data.get("text") or "").strip() or None,
        currency=currency,
        subtotal=subtotal,
        status=CatalogOrderStatus.RECEIVED,
        line_items=build_line_items(order_data, product_names=product_names),
    )
    db.add(order)
    await db.flush()
    return order


async def notify_catalog_order_received(
    db: AsyncSession,
    *,
    account_id: UUID,
    order: CatalogOrder,
    contact_name: str | None = None,
) -> None:
    """Create in-app notification and send email with invoice PDF."""
    from app.services.email_notifications import send_catalog_order_notification
    from app.services.notifications import create_notification

    customer = contact_name or "عميل"
    title = f"طلب كتالوج جديد — {order.order_number}"
    body = f"استلم {customer} طلبًا من WhatsApp Catalog بقيمة {order.subtotal} {order.currency}."
    await create_notification(
        db,
        account_id=account_id,
        user_id=None,
        type="catalog_order_received",
        title=title,
        body=body,
        data={
            "catalog_order_id": str(order.id),
            "order_number": order.order_number,
            "conversation_id": str(order.conversation_id) if order.conversation_id else None,
        },
    )
    try:
        await send_catalog_order_notification(db, account_id=account_id, order=order)
    except Exception:
        logger.exception("Catalog order email notification failed for order %s", order.id)


async def backfill_catalog_orders_from_messages(db: AsyncSession, *, account_id: UUID) -> int:
    """Create catalog_orders rows for legacy inbound ORDER messages."""
    from app.models.deal import Deal

    rows = (
        await db.execute(
            select(Message)
            .where(
                Message.account_id == account_id,
                Message.type == MessageType.ORDER,
            )
            .order_by(Message.created_at.asc())
        )
    ).scalars().all()
    if not rows:
        return 0

    message_ids = [row.id for row in rows]
    existing_ids = set(
        (
            await db.execute(
                select(CatalogOrder.message_id).where(CatalogOrder.message_id.in_(message_ids))
            )
        )
        .scalars()
        .all()
    )
    created = 0
    for message in rows:
        if message.id in existing_ids:
            continue
        payload = message.provider_payload if isinstance(message.provider_payload, dict) else {}
        order_data = payload.get("order_parsed")
        if not isinstance(order_data, dict):
            order_item = dict(payload)
            from app.services.inbound_commerce import parse_whatsapp_order

            order_data = parse_whatsapp_order(order_item)
        if not order_data:
            continue
        deal_id = None
        if message.contact_id:
            deal_row = (
                await db.execute(
                    select(Deal)
                    .where(
                        Deal.account_id == account_id,
                        Deal.contact_id == message.contact_id,
                        Deal.source == "whatsapp_order",
                    )
                    .order_by(Deal.created_at.desc())
                )
            ).scalars().first()
            if deal_row:
                delta = abs((deal_row.created_at - message.created_at).total_seconds())
                if delta <= 120:
                    deal_id = deal_row.id
        await create_catalog_order(
            db,
            account_id=message.account_id,
            organization_id=message.organization_id,
            channel_id=message.channel_id,
            contact_id=message.contact_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            deal_id=deal_id,
            order_data=order_data,
        )
        created += 1
    return created


async def list_catalog_orders(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[CatalogOrder], int]:
    await backfill_catalog_orders_from_messages(db, account_id=account_id)

    query = (
        select(CatalogOrder)
        .options(selectinload(CatalogOrder.contact))
        .where(CatalogOrder.account_id == account_id)
        .order_by(CatalogOrder.created_at.desc())
    )
    count_query = select(func.count()).select_from(CatalogOrder).where(CatalogOrder.account_id == account_id)

    if organization_id is not None:
        query = query.where(CatalogOrder.organization_id == organization_id)
        count_query = count_query.where(CatalogOrder.organization_id == organization_id)
    if status:
        query = query.where(CatalogOrder.status == status)
        count_query = count_query.where(CatalogOrder.status == status)
    if search:
        like = f"%{search.strip()}%"
        query = query.join(Contact, Contact.id == CatalogOrder.contact_id).where(
            (CatalogOrder.order_number.ilike(like))
            | (Contact.display_name.ilike(like))
            | (Contact.external_address.ilike(like))
        )
        count_query = count_query.join(Contact, Contact.id == CatalogOrder.contact_id).where(
            (CatalogOrder.order_number.ilike(like))
            | (Contact.display_name.ilike(like))
            | (Contact.external_address.ilike(like))
        )

    total = int(await db.scalar(count_query) or 0)
    offset = max(page - 1, 0) * page_size
    items = (await db.execute(query.offset(offset).limit(page_size))).scalars().unique().all()
    return list(items), total


async def get_catalog_order(
    db: AsyncSession,
    *,
    account_id: UUID,
    order_id: UUID,
) -> CatalogOrder | None:
    await backfill_catalog_orders_from_messages(db, account_id=account_id)
    return (
        await db.execute(
            select(CatalogOrder)
            .options(selectinload(CatalogOrder.contact))
            .where(CatalogOrder.account_id == account_id, CatalogOrder.id == order_id)
        )
    ).scalar_one_or_none()


async def update_catalog_order_status(
    db: AsyncSession,
    *,
    order: CatalogOrder,
    status: str,
    reviewed_by_user_id: UUID | None = None,
) -> CatalogOrder:
    order.status = status
    if status in {CatalogOrderStatus.REVIEWED, CatalogOrderStatus.INVOICED}:
        order.reviewed_at = datetime.now(UTC)
        order.reviewed_by_user_id = reviewed_by_user_id
    await db.flush()
    return order


async def get_invoice_context(
    db: AsyncSession,
    *,
    account_id: UUID,
    order: CatalogOrder,
) -> dict[str, Any]:
    account = await db.get(Account, account_id)
    organization = await db.get(Organization, order.organization_id)
    contact = await db.get(Contact, order.contact_id)
    return {
        "company_name": organization.name if organization else (account.name if account else "Watesly"),
        "account_name": account.name if account else "",
        "organization_name": organization.name if organization else "",
        "customer_name": contact.display_name if contact and contact.display_name else "عميل",
        "customer_phone": contact.external_address if contact else "",
        "order_number": order.order_number,
        "created_at": order.created_at,
        "currency": order.currency,
        "subtotal": order.subtotal,
        "customer_note": order.customer_note,
        "line_items": order.line_items or [],
        "status": order.status,
    }
