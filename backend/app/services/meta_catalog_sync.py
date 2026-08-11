"""Sync internal catalog products to Meta Commerce Catalog."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.catalog_product import CatalogProduct
from app.models.whatsapp_account import WhatsAppAccount
from app.services.catalog_commerce import resolve_retailer_id
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient


def _format_price(product: CatalogProduct) -> str:
    if product.price is None:
        return "0.00"
    return f"{product.price:.2f}"


async def sync_catalog_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    product_ids: list[UUID] | None = None,
) -> dict:
    account = await db.get(WhatsAppAccount, whatsapp_account_id)
    if account is None or account.account_id != account_id:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
    if not account.meta_catalog_id:
        raise ValueError("META_CATALOG_NOT_CONFIGURED")

    query = select(CatalogProduct).where(
        CatalogProduct.account_id == account_id,
        CatalogProduct.is_active.is_(True),
    )
    if product_ids:
        query = query.where(CatalogProduct.id.in_(product_ids))
    products = list((await db.execute(query.order_by(CatalogProduct.sort_order.asc()))).scalars().all())
    if not products:
        return {"synced": 0, "failed": 0, "total": 0}

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(account.access_token_encrypted),
        phone_number_id=account.phone_number_id,
    )
    synced = failed = 0
    errors: list[str] = []
    try:
        for product in products:
            retailer_id = resolve_retailer_id(product)
            if not product.meta_retailer_id:
                product.meta_retailer_id = retailer_id
            payload = {
                "name": product.name[:200],
                "description": (product.description or product.name)[:9999],
                "retailer_id": retailer_id,
                "price": str(int(float(_format_price(product)) * 100)),
                "currency": product.currency or "KWD",
                "availability": "in stock",
                "condition": "new",
            }
            if product.image_url:
                payload["image_url"] = product.image_url
            try:
                if product.external_source == "meta" and product.external_id:
                    await client.update_catalog_product(
                        catalog_id=account.meta_catalog_id,
                        product_id=product.external_id,
                        payload=payload,
                    )
                else:
                    response = await client.create_catalog_product(
                        catalog_id=account.meta_catalog_id,
                        payload=payload,
                    )
                    product.external_source = "meta"
                    product.external_id = str(response.get("id", "")) or product.external_id
                synced += 1
            except MetaAPIError as exc:
                failed += 1
                errors.append(f"{product.name}: {exc}"[:500])
        account.catalog_synced_at = datetime.now(UTC)
        await db.commit()
    finally:
        await client.aclose()

    return {
        "synced": synced,
        "failed": failed,
        "total": len(products),
        "errors": errors[:20],
    }
