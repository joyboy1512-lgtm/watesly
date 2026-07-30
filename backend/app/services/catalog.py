from decimal import Decimal
from uuid import UUID

import csv
import io

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog_product import CatalogProduct


async def list_catalog_products(
    db: AsyncSession,
    account_id: UUID,
    *,
    active_only: bool = True,
    organization_id: UUID | None = None,
    category: str | None = None,
) -> list[CatalogProduct]:
    query = select(CatalogProduct).where(CatalogProduct.account_id == account_id)
    if active_only:
        query = query.where(CatalogProduct.is_active.is_(True))
    if organization_id is not None:
        query = query.where(CatalogProduct.organization_id == organization_id)
    if category:
        query = query.where(CatalogProduct.category == category)
    query = query.order_by(CatalogProduct.sort_order.asc(), CatalogProduct.name.asc())
    return list((await db.execute(query)).scalars().all())


async def get_catalog_product(db: AsyncSession, *, account_id: UUID, product_id: UUID) -> CatalogProduct:
    item = await db.get(CatalogProduct, product_id)
    if item is None or item.account_id != account_id:
        raise ValueError("PRODUCT_NOT_FOUND")
    return item


async def create_catalog_product(db: AsyncSession, *, account_id: UUID, **fields) -> CatalogProduct:
    item = CatalogProduct(account_id=account_id, **fields)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_catalog_product(
    db: AsyncSession, *, account_id: UUID, product_id: UUID, **fields
) -> CatalogProduct:
    item = await get_catalog_product(db, account_id=account_id, product_id=product_id)
    for key, value in fields.items():
        if value is not None and hasattr(item, key):
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def delete_catalog_product(db: AsyncSession, *, account_id: UUID, product_id: UUID) -> None:
    item = await get_catalog_product(db, account_id=account_id, product_id=product_id)
    item.is_active = False
    await db.commit()


async def search_catalog_products(
    db: AsyncSession,
    account_id: UUID,
    query: str,
    *,
    limit: int = 8,
    active_only: bool = True,
    organization_id: UUID | None = None,
    category: str | None = None,
) -> list[CatalogProduct]:
    term = f"%{query.strip()}%"
    if not query.strip():
        return await list_catalog_products(
            db,
            account_id,
            active_only=active_only,
            organization_id=organization_id,
            category=category,
        )

    filters = [
        CatalogProduct.account_id == account_id,
        or_(
            CatalogProduct.name.ilike(term),
            CatalogProduct.description.ilike(term),
            CatalogProduct.keywords.ilike(term),
            CatalogProduct.sku.ilike(term),
        ),
    ]
    if active_only:
        filters.append(CatalogProduct.is_active.is_(True))
    if organization_id is not None:
        filters.append(CatalogProduct.organization_id == organization_id)
    if category:
        filters.append(CatalogProduct.category == category)

    result = await db.execute(
        select(CatalogProduct)
        .where(*filters)
        .order_by(CatalogProduct.sort_order.asc(), CatalogProduct.name.asc())
        .limit(limit)
    )
    items = list(result.scalars().all())
    if items:
        return items
    return (await list_catalog_products(db, account_id, active_only=active_only))[:limit]


def format_price(product: CatalogProduct) -> str:
    if product.price_type == "quote" or product.price is None:
        return "اطلب عرض سعر"
    if product.price_type == "from":
        return f"من {product.price} {product.currency}"
    return f"{product.price} {product.currency}"


def format_specs(specs: dict) -> str:
    if not specs:
        return ""
    parts = [f"{k}: {v}" for k, v in specs.items()]
    return " · ".join(parts[:6])


def build_catalog_reply(products: list[CatalogProduct], *, contact_name: str = "", query: str = "") -> dict:
    if not products:
        name = contact_name or "عميلنا"
        return {
            "suggestion": f"مرحباً {name}! شكراً لتواصلك. سأتحقق من المنتجات المتاحة وأرد عليك قريباً.",
            "matched_products": [],
            "confidence": 0.4,
            "source": "catalog",
        }

    lines = []
    matched = []
    for product in products[:5]:
        price = format_price(product)
        specs = format_specs(product.specs_json or {})
        line = f"• *{product.name}* — {price}"
        if specs:
            line += f"\n  {specs}"
        if product.description:
            line += f"\n  {product.description[:120]}"
        lines.append(line)
        matched.append({
            "id": str(product.id),
            "name": product.name,
            "price": str(product.price) if product.price is not None else None,
            "currency": product.currency,
            "price_label": price,
            "image_url": product.image_url,
            "description": (product.description or "")[:160] or None,
            "specs_preview": specs or None,
            "product_type": product.product_type,
            "meta_retailer_id": product.meta_retailer_id,
            "category": product.category,
        })

    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    body = "\n\n".join(lines)
    suggestion = f"{greeting}إليك ما يناسب استفسارك:\n\n{body}\n\nهل تريد تفاصيل أكثر أو حجز/طلب؟"

    return {
        "suggestion": suggestion,
        "matched_products": matched,
        "confidence": 0.85 if len(products) == 1 else 0.75,
        "source": "catalog",
        "query": query,
    }


async def import_catalog_from_rows(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID | None,
    rows: list[dict[str, str]],
) -> dict:
    from app.services.spreadsheet import (
        collect_spec_columns,
        get_row_value,
        normalize_price_type,
        normalize_product_type,
    )

    created = skipped = 0
    for row in rows:
        name = get_row_value(row, "product_name")
        if not name:
            skipped += 1
            continue

        price_raw = get_row_value(row, "price")
        price_type = normalize_price_type(get_row_value(row, "price_type") or "fixed")
        price = None
        if price_raw and price_type != "quote":
            try:
                price = Decimal(price_raw.replace(",", ""))
            except Exception:
                skipped += 1
                continue

        await create_catalog_product(
            db,
            account_id=account_id,
            organization_id=organization_id,
            name=name,
            sku=get_row_value(row, "sku") or None,
            product_type=normalize_product_type(get_row_value(row, "product_type") or "product"),
            description=get_row_value(row, "description") or None,
            price=price,
            currency=(get_row_value(row, "currency") or "KWD").upper()[:3],
            price_type=price_type,
            specs_json=collect_spec_columns(row),
            keywords=get_row_value(row, "keywords") or None,
        )
        created += 1
    return {"created": created, "skipped": skipped}


async def import_catalog_file(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID | None,
    content: bytes,
    filename: str,
) -> dict:
    from app.services.spreadsheet import parse_spreadsheet

    rows = parse_spreadsheet(content, filename)
    return await import_catalog_from_rows(
        db,
        account_id=account_id,
        organization_id=organization_id,
        rows=rows,
    )


async def suggest_catalog_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    query: str,
    contact_name: str = "",
) -> dict:
    products = await search_catalog_products(db, account_id, query)
    lower = query.lower()
    price_words = ("سعر", "price", "cost", "كم", "تكلف", "offer", "عرض")
    if any(w in lower for w in price_words) and products:
        return build_catalog_reply(products, contact_name=contact_name, query=query)
    if products and query.strip():
        return build_catalog_reply(products, contact_name=contact_name, query=query)
    all_products = await list_catalog_products(db, account_id)
    if all_products and any(w in lower for w in ("منتج", "خدم", "product", "service", "قائمة", "menu")):
        return build_catalog_reply(all_products[:5], contact_name=contact_name, query=query)
    return build_catalog_reply(products, contact_name=contact_name, query=query)


async def preview_catalog_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    query: str = "",
    contact_name: str = "",
    product_ids: list[UUID] | None = None,
) -> dict:
    if product_ids:
        products: list[CatalogProduct] = []
        for product_id in product_ids[:5]:
            try:
                products.append(await get_catalog_product(db, account_id=account_id, product_id=product_id))
            except ValueError:
                continue
        products = [item for item in products if item.is_active]
    elif query.strip():
        products = await search_catalog_products(db, account_id, query, limit=5)
    else:
        products = (await list_catalog_products(db, account_id))[:5]
    return build_catalog_reply(products, contact_name=contact_name, query=query)


CATALOG_EXPORT_HEADERS = [
    "name",
    "sku",
    "product_type",
    "price",
    "price_type",
    "currency",
    "description",
    "keywords",
    "category",
    "image_url",
    "meta_retailer_id",
    "sort_order",
    "specs",
]


def _catalog_export_row(item: CatalogProduct) -> list[object]:
    specs = " | ".join(f"{key}={value}" for key, value in (item.specs_json or {}).items())
    return [
        item.name,
        item.sku or "",
        item.product_type,
        str(item.price) if item.price is not None else "",
        item.price_type,
        item.currency,
        item.description or "",
        item.keywords or "",
        item.category or "",
        item.image_url or "",
        item.meta_retailer_id or "",
        item.sort_order,
        specs,
    ]


async def export_catalog_csv(db: AsyncSession, *, account_id: UUID, active_only: bool = True) -> str:
    products = await list_catalog_products(db, account_id, active_only=active_only)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CATALOG_EXPORT_HEADERS)
    for item in products:
        writer.writerow(_catalog_export_row(item))
    return buffer.getvalue()


async def export_catalog_xlsx(db: AsyncSession, *, account_id: UUID, active_only: bool = True) -> bytes:
    from openpyxl import Workbook

    products = await list_catalog_products(db, account_id, active_only=active_only)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "المنتجات"
    sheet.append(CATALOG_EXPORT_HEADERS)
    for item in products:
        sheet.append(_catalog_export_row(item))

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
