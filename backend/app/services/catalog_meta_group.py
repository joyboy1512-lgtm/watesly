"""Create and manage Meta catalog product groups (variants)."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog_product import CatalogProduct
from app.services.catalog import create_catalog_product, update_catalog_product


def _normalize_group_id(value: str) -> str:
    return value.strip()[:80]


def _build_variant_name(base_name: str, *, size: str | None, color: str | None) -> str:
    parts = [base_name.strip()]
    if color and color.strip():
        parts.append(color.strip())
    if size and size.strip():
        parts.append(size.strip())
    name = " — ".join(parts)
    return name[:200] if name else base_name[:200]


async def get_catalog_meta_group(
    db: AsyncSession,
    *,
    account_id: UUID,
    meta_item_group_id: str,
    membership=None,
) -> dict:
    from app.services.membership_access import catalog_scope_clauses

    group_id = _normalize_group_id(meta_item_group_id)
    if not group_id:
        raise ValueError("GROUP_ID_REQUIRED")

    query = select(CatalogProduct).where(
        CatalogProduct.account_id == account_id,
        CatalogProduct.meta_item_group_id == group_id,
        CatalogProduct.is_active.is_(True),
    )
    if membership is not None:
        for clause in await catalog_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            channel_column=CatalogProduct.channel_id,
            organization_column=CatalogProduct.organization_id,
        ):
            query = query.where(clause)
    products = list(
        (await db.execute(query.order_by(CatalogProduct.sort_order.asc(), CatalogProduct.name.asc()))).scalars().all()
    )
    if not products:
        raise ValueError("GROUP_NOT_FOUND")

    first = products[0]
    return {
        "meta_item_group_id": group_id,
        "base_name": first.name.split(" — ")[0][:200],
        "organization_id": first.organization_id,
        "channel_id": first.channel_id,
        "category": first.category,
        "description": first.description,
        "product_type": first.product_type,
        "currency": first.currency,
        "price_type": first.price_type,
        "meta_sync_enabled": all(item.meta_sync_enabled for item in products),
        "variants": [
            {
                "id": str(item.id),
                "name": item.name,
                "sku": item.sku,
                "meta_retailer_id": item.meta_retailer_id,
                "variant_size": item.variant_size,
                "variant_color": item.variant_color,
                "variant_attributes": item.variant_attributes or {},
                "price": str(item.price) if item.price is not None else None,
                "image_url": item.image_url,
                "sort_order": item.sort_order,
                "meta_sync_status": item.meta_sync_status,
                "meta_review_status": item.meta_review_status,
            }
            for item in products
        ],
    }


async def create_catalog_meta_group(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership=None,
    meta_item_group_id: str,
    base_name: str,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
    category: str | None = None,
    description: str | None = None,
    product_type: str = "product",
    currency: str = "KWD",
    price_type: str = "fixed",
    meta_sync_enabled: bool = True,
    variants: list[dict],
    ) -> dict:
    group_id = _normalize_group_id(meta_item_group_id)
    if not group_id:
        raise ValueError("GROUP_ID_REQUIRED")
    if not variants:
        raise ValueError("VARIANTS_REQUIRED")

    created: list[CatalogProduct] = []
    for index, variant in enumerate(variants):
        name = (variant.get("name") or "").strip() or _build_variant_name(
            base_name,
            size=variant.get("variant_size"),
            color=variant.get("variant_color"),
        )
        price_raw = variant.get("price")
        price = None if price_type == "quote" or price_raw in (None, "") else Decimal(str(price_raw))
        item = await create_catalog_product(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=organization_id,
            channel_id=channel_id,
            name=name,
            sku=variant.get("sku") or None,
            product_type=product_type,
            description=description,
            price=price,
            currency=currency,
            price_type=price_type,
            category=category,
            image_url=variant.get("image_url") or None,
            meta_retailer_id=variant.get("meta_retailer_id") or None,
            meta_item_group_id=group_id,
            variant_size=variant.get("variant_size") or None,
            variant_color=variant.get("variant_color") or None,
            variant_attributes=variant.get("variant_attributes") or {},
            meta_sync_enabled=meta_sync_enabled,
            sort_order=int(variant.get("sort_order") if variant.get("sort_order") is not None else index),
        )
        created.append(item)
    return await get_catalog_meta_group(
        db,
        account_id=account_id,
        meta_item_group_id=group_id,
        membership=membership,
    )


async def update_catalog_meta_group(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership=None,
    meta_item_group_id: str,
    base_name: str,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
    category: str | None = None,
    description: str | None = None,
    product_type: str = "product",
    currency: str = "KWD",
    price_type: str = "fixed",
    meta_sync_enabled: bool = True,
    variants: list[dict],
    ) -> dict:
    from app.services.catalog import delete_catalog_product

    group_id = _normalize_group_id(meta_item_group_id)
    if not group_id:
        raise ValueError("GROUP_ID_REQUIRED")
    if not variants:
        raise ValueError("VARIANTS_REQUIRED")

    existing = list(
        (
            await db.execute(
                select(CatalogProduct).where(
                    CatalogProduct.account_id == account_id,
                    CatalogProduct.meta_item_group_id == group_id,
                    CatalogProduct.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    existing_map = {str(item.id): item for item in existing}
    kept_ids: set[str] = set()
    resolved_channel_id = channel_id or (existing[0].channel_id if existing else None)

    for index, variant in enumerate(variants):
        variant_id = str(variant.get("id") or "").strip()
        name = (variant.get("name") or "").strip() or _build_variant_name(
            base_name,
            size=variant.get("variant_size"),
            color=variant.get("variant_color"),
        )
        price_raw = variant.get("price")
        price = None if price_type == "quote" or price_raw in (None, "") else Decimal(str(price_raw))
        fields = {
            "organization_id": organization_id,
            "channel_id": resolved_channel_id,
            "name": name,
            "sku": variant.get("sku") or None,
            "product_type": product_type,
            "description": description,
            "price": price,
            "currency": currency,
            "price_type": price_type,
            "category": category,
            "image_url": variant.get("image_url") or None,
            "meta_retailer_id": variant.get("meta_retailer_id") or None,
            "meta_item_group_id": group_id,
            "variant_size": variant.get("variant_size") or None,
            "variant_color": variant.get("variant_color") or None,
            "variant_attributes": variant.get("variant_attributes") or {},
            "meta_sync_enabled": meta_sync_enabled,
            "sort_order": int(variant.get("sort_order") if variant.get("sort_order") is not None else index),
        }
        if variant_id and variant_id in existing_map:
            kept_ids.add(variant_id)
            await update_catalog_product(
                db,
                account_id=account_id,
                product_id=UUID(variant_id),
                membership=membership,
                **fields,
            )
        else:
            await create_catalog_product(
                db,
                account_id=account_id,
                membership=membership,
                **fields,
            )

    for product_id, item in existing_map.items():
        if product_id not in kept_ids:
            await delete_catalog_product(
                db,
                account_id=account_id,
                product_id=item.id,
                membership=membership,
            )
    return await get_catalog_meta_group(
        db,
        account_id=account_id,
        meta_item_group_id=group_id,
        membership=membership,
    )
