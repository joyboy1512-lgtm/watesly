"""WhatsApp Commerce helpers for internal catalog products."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog_product import CatalogProduct
from app.models.whatsapp_account import WhatsAppAccount


def resolve_retailer_id(product: CatalogProduct) -> str:
    if product.meta_retailer_id and product.meta_retailer_id.strip():
        return product.meta_retailer_id.strip()
    if product.sku and product.sku.strip():
        return product.sku.strip()[:80]
    return str(product.id).replace("-", "")[:80]


def product_commerce_ready(product: CatalogProduct) -> bool:
    return product.is_active and bool(resolve_retailer_id(product))


def account_commerce_ready(account: WhatsAppAccount) -> bool:
    return bool(account.commerce_enabled and account.meta_catalog_id)


async def increment_product_usage(db: AsyncSession, *, product: CatalogProduct) -> None:
    product.usage_count = (product.usage_count or 0) + 1
    await db.commit()


async def list_catalog_categories(db: AsyncSession, account_id: UUID) -> list[str]:
    rows = (
        await db.execute(
            select(CatalogProduct.category)
            .where(
                CatalogProduct.account_id == account_id,
                CatalogProduct.is_active.is_(True),
                CatalogProduct.category.is_not(None),
                CatalogProduct.category != "",
            )
            .distinct()
            .order_by(CatalogProduct.category.asc())
        )
    ).all()
    return [row[0] for row in rows if row[0]]


async def prepare_catalog_commerce_ids(db: AsyncSession, *, account_id: UUID) -> dict:
    products = list(
        (
            await db.execute(
                select(CatalogProduct).where(
                    CatalogProduct.account_id == account_id,
                    CatalogProduct.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    updated = 0
    for product in products:
        if product.meta_retailer_id:
            continue
        product.meta_retailer_id = resolve_retailer_id(product)
        updated += 1
    await db.commit()
    return {"updated": updated, "total": len(products)}


async def commerce_readiness(db: AsyncSession, *, account_id: UUID, whatsapp_account_id: UUID) -> dict:
    account = await db.get(WhatsAppAccount, whatsapp_account_id)
    if account is None or account.account_id != account_id:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")

    total_active = (
        await db.execute(
            select(func.count())
            .select_from(CatalogProduct)
            .where(CatalogProduct.account_id == account_id, CatalogProduct.is_active.is_(True))
        )
    ).scalar_one()
    with_retailer = (
        await db.execute(
            select(func.count())
            .select_from(CatalogProduct)
            .where(
                CatalogProduct.account_id == account_id,
                CatalogProduct.is_active.is_(True),
                CatalogProduct.meta_retailer_id.is_not(None),
                CatalogProduct.meta_retailer_id != "",
            )
        )
    ).scalar_one()
    top_used = list(
        (
            await db.execute(
                select(CatalogProduct)
                .where(CatalogProduct.account_id == account_id, CatalogProduct.is_active.is_(True))
                .order_by(CatalogProduct.usage_count.desc(), CatalogProduct.name.asc())
                .limit(5)
            )
        ).scalars().all()
    )

    return {
        "commerce_enabled": bool(account.commerce_enabled),
        "meta_catalog_id": account.meta_catalog_id,
        "catalog_synced_at": account.catalog_synced_at,
        "account_ready": account_commerce_ready(account),
        "products_active": int(total_active or 0),
        "products_with_retailer_id": int(with_retailer or 0),
        "top_products": [
            {
                "id": str(item.id),
                "name": item.name,
                "usage_count": item.usage_count,
                "meta_retailer_id": item.meta_retailer_id,
            }
            for item in top_used
        ],
    }


def build_product_list_sections(products: list[CatalogProduct], *, max_items: int = 30) -> list[dict]:
    grouped: dict[str, list[CatalogProduct]] = {}
    for product in products[:max_items]:
        key = (product.category or "منتجات").strip() or "منتجات"
        grouped.setdefault(key, []).append(product)

    sections: list[dict] = []
    for title, items in grouped.items():
        sections.append(
            {
                "title": title[:24],
                "product_items": [
                    {"product_retailer_id": resolve_retailer_id(item)} for item in items[:10]
                ],
            }
        )
    return sections[:10]


async def update_whatsapp_commerce_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    meta_catalog_id: str | None = None,
    commerce_enabled: bool | None = None,
) -> WhatsAppAccount:
    account = await db.get(WhatsAppAccount, whatsapp_account_id)
    if account is None or account.account_id != account_id:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
    if meta_catalog_id is not None:
        account.meta_catalog_id = meta_catalog_id.strip() or None
    if commerce_enabled is not None:
        account.commerce_enabled = commerce_enabled
    if account.commerce_enabled and account.meta_catalog_id:
        account.catalog_synced_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(account)
    return account
