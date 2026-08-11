"""Parse inbound WhatsApp commerce messages (orders, product inquiries)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog_product import CatalogProduct
from app.models.message import MessageType


def extract_referred_product(message_item: dict) -> dict | None:
    context = message_item.get("context")
    if not isinstance(context, dict):
        return None
    referred = context.get("referred_product")
    if not isinstance(referred, dict):
        return None
    catalog_id = str(referred.get("catalog_id") or "").strip()
    retailer_id = str(referred.get("product_retailer_id") or "").strip()
    if not catalog_id and not retailer_id:
        return None
    return {
        "catalog_id": catalog_id,
        "product_retailer_id": retailer_id,
    }


def parse_whatsapp_order(message_item: dict) -> dict | None:
    if str(message_item.get("type") or "").lower() != "order":
        return None
    order = message_item.get("order")
    if not isinstance(order, dict):
        return None
    items: list[dict[str, Any]] = []
    for raw in order.get("product_items") or []:
        if not isinstance(raw, dict):
            continue
        retailer_id = str(raw.get("product_retailer_id") or "").strip()
        if not retailer_id:
            continue
        quantity = int(raw.get("quantity") or 1)
        item_price = raw.get("item_price")
        currency = str(raw.get("currency") or order.get("currency") or "KWD").strip() or "KWD"
        items.append(
            {
                "product_retailer_id": retailer_id,
                "quantity": max(quantity, 1),
                "item_price": item_price,
                "currency": currency,
            }
        )
    if not items:
        return None
    return {
        "catalog_id": str(order.get("catalog_id") or "").strip(),
        "text": str(order.get("text") or "").strip(),
        "product_items": items,
    }


async def resolve_order_product_names(
    db: AsyncSession,
    *,
    account_id: UUID,
    product_items: list[dict[str, Any]],
) -> dict[str, str]:
    retailer_ids = [item["product_retailer_id"] for item in product_items if item.get("product_retailer_id")]
    if not retailer_ids:
        return {}
    rows = (
        await db.execute(
            select(CatalogProduct.meta_retailer_id, CatalogProduct.name).where(
                CatalogProduct.account_id == account_id,
                CatalogProduct.meta_retailer_id.in_(retailer_ids),
            )
        )
    ).all()
    return {str(retailer_id): name for retailer_id, name in rows if retailer_id}


def format_order_text(
    order_data: dict,
    *,
    product_names: dict[str, str] | None = None,
) -> str:
    product_names = product_names or {}
    lines: list[str] = ["🛒 طلب من كتالوج واتساب"]
    total = Decimal("0")
    currency = "KWD"
    for item in order_data.get("product_items") or []:
        retailer_id = item["product_retailer_id"]
        name = product_names.get(retailer_id) or retailer_id
        qty = item.get("quantity") or 1
        currency = str(item.get("currency") or currency)
        price = item.get("item_price")
        if price is not None:
            line_total = Decimal(str(price)) * Decimal(str(qty))
            total += line_total
            lines.append(f"• {name} × {qty} — {price} {currency}")
        else:
            lines.append(f"• {name} × {qty}")
    if total > 0:
        lines.append(f"الإجمالي: {total:.2f} {currency}")
    note = str(order_data.get("text") or "").strip()
    if note:
        lines.append(f"ملاحظة العميل: {note}")
    return "\n".join(lines)


def order_total_amount(order_data: dict) -> tuple[Decimal, str]:
    total = Decimal("0")
    currency = "KWD"
    for item in order_data.get("product_items") or []:
        currency = str(item.get("currency") or currency)
        price = item.get("item_price")
        qty = item.get("quantity") or 1
        if price is not None:
            total += Decimal(str(price)) * Decimal(str(qty))
    return total, currency


async def create_deal_from_whatsapp_order(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    organization_id: UUID | None,
    order_data: dict,
    conversation_id: UUID | None = None,
) -> Any:
    from app.models.contact import Contact
    from app.services.crm import create_deal

    contact = await db.get(Contact, contact_id)
    display = contact.display_name if contact else None
    product_names = await resolve_order_product_names(
        db,
        account_id=account_id,
        product_items=order_data.get("product_items") or [],
    )
    amount, currency = order_total_amount(order_data)
    description = format_order_text(order_data, product_names=product_names)
    item_count = sum(int(item.get("quantity") or 1) for item in order_data.get("product_items") or [])
    title = f"طلب واتساب — {display or 'عميل'} ({item_count} صنف)"
    deal = await create_deal(
        db,
        account_id=account_id,
        contact_id=contact_id,
        title=title[:200],
        stage="lead",
        amount=amount,
        currency=currency,
        organization_id=organization_id,
        source="whatsapp_order",
        description=description[:4000],
        probability=60,
    )
    if conversation_id is not None:
        from app.models.deal import DealActivity

        db.add(
            DealActivity(
                deal_id=deal.id,
                activity_type="note",
                body=f"تم إنشاء الصفقة تلقائياً من طلب كتالوج واتساب.\nconversation_id={conversation_id}",
            )
        )
        await db.flush()
    return deal


def inbound_message_type_for_item(message_type_value: str) -> MessageType:
    lowered = str(message_type_value or "unknown").lower()
    if lowered == "order":
        return MessageType.ORDER
    if lowered == "sticker":
        return MessageType.IMAGE
    try:
        return MessageType(lowered)
    except ValueError:
        return MessageType.UNKNOWN
