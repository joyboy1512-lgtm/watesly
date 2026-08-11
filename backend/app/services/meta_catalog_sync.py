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


def parse_meta_review_status(data: dict) -> tuple[str | None, str | None]:
    raw = data.get("capability_to_review_status") or data.get("review_status")
    status: str | None = None

    if isinstance(raw, dict):
        status = raw.get("whatsapp") or raw.get("WHATSAPP")
        if status is None and raw:
            status = next(iter(raw.values()), None)
    elif isinstance(raw, list) and raw:
        for item in raw:
            if not isinstance(item, dict):
                continue
            capability = str(item.get("capability") or "").lower()
            if capability in {"whatsapp", "wa"}:
                status = item.get("status")
                break
        if status is None and isinstance(raw[0], dict):
            status = raw[0].get("status")
        elif status is None:
            status = raw[0]
    elif raw is not None:
        status = raw

    detail: str | None = None
    reasons = data.get("review_rejection_reasons")
    if reasons:
        if isinstance(reasons, list):
            detail = "; ".join(str(item) for item in reasons[:3])
        else:
            detail = str(reasons)

    if status is not None:
        status = str(status).strip().lower()
    if detail:
        detail = detail[:500]
    return status, detail


def normalize_review_status(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip().lower().replace("-", "_")
    mapping = {
        "pending": "pending",
        "approved": "approved",
        "rejected": "rejected",
        "outdated": "outdated",
        "no_review": "no_review",
    }
    return mapping.get(value, "unknown")


def apply_meta_product_status(
    product: CatalogProduct,
    *,
    data: dict | None = None,
    sync_status: str | None = None,
    sync_error: str | None = None,
) -> None:
    now = datetime.now(UTC)
    if sync_status is not None:
        product.meta_sync_status = sync_status
    if sync_error is not None:
        product.meta_sync_error = sync_error[:500] if sync_error else None
    if sync_status == "synced":
        product.meta_synced_at = now
        product.meta_sync_error = None
    if data:
        review_status, detail = parse_meta_review_status(data)
        product.meta_review_status = normalize_review_status(review_status)
        product.meta_review_detail = detail
        meta_id = str(data.get("id") or "").strip()
        if meta_id:
            product.external_source = "meta"
            product.external_id = meta_id


async def _get_commerce_whatsapp_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID | None = None,
) -> WhatsAppAccount:
    if whatsapp_account_id is not None:
        account = await db.get(WhatsAppAccount, whatsapp_account_id)
        if account is None or account.account_id != account_id:
            raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
        if not account.meta_catalog_id:
            raise ValueError("META_CATALOG_NOT_CONFIGURED")
        return account

    account = (
        await db.execute(
            select(WhatsAppAccount)
            .where(
                WhatsAppAccount.account_id == account_id,
                WhatsAppAccount.commerce_enabled.is_(True),
                WhatsAppAccount.meta_catalog_id.is_not(None),
                WhatsAppAccount.meta_catalog_id != "",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if account is None:
        raise ValueError("META_CATALOG_NOT_CONFIGURED")
    return account


async def _build_meta_client(db: AsyncSession, account: WhatsAppAccount) -> MetaWhatsAppClient:
    return MetaWhatsAppClient(
        access_token=decrypt_secret(account.access_token_encrypted),
        phone_number_id=account.phone_number_id,
    )


async def refresh_product_meta_status(
    client: MetaWhatsAppClient,
    product: CatalogProduct,
) -> bool:
    if not product.external_id:
        return False
    data = await client.get_catalog_product(product_id=product.external_id)
    apply_meta_product_status(product, data=data, sync_status="synced")
    return True


async def refresh_catalog_meta_status(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID | None = None,
    product_ids: list[UUID] | None = None,
) -> dict:
    account = await _get_commerce_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )
    query = select(CatalogProduct).where(
        CatalogProduct.account_id == account_id,
        CatalogProduct.is_active.is_(True),
        CatalogProduct.external_id.is_not(None),
        CatalogProduct.external_id != "",
    )
    if product_ids:
        query = query.where(CatalogProduct.id.in_(product_ids))
    products = list((await db.execute(query.order_by(CatalogProduct.sort_order.asc()))).scalars().all())
    if not products:
        return {
            "refreshed": 0,
            "failed": 0,
            "total": 0,
            "pending": 0,
            "approved": 0,
            "rejected": 0,
        }

    client = await _build_meta_client(db, account)
    refreshed = failed = pending = approved = rejected = 0
    errors: list[str] = []
    try:
        for product in products:
            try:
                await refresh_product_meta_status(client, product)
                refreshed += 1
                if product.meta_review_status == "pending":
                    pending += 1
                elif product.meta_review_status == "approved":
                    approved += 1
                elif product.meta_review_status == "rejected":
                    rejected += 1
            except MetaAPIError as exc:
                failed += 1
                errors.append(f"{product.name}: {exc}"[:500])
        account.catalog_synced_at = datetime.now(UTC)
        await db.commit()
    finally:
        await client.aclose()

    return {
        "refreshed": refreshed,
        "failed": failed,
        "total": len(products),
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "errors": errors[:20],
    }


async def sync_catalog_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    product_ids: list[UUID] | None = None,
) -> dict:
    account = await _get_commerce_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )

    query = select(CatalogProduct).where(
        CatalogProduct.account_id == account_id,
        CatalogProduct.is_active.is_(True),
    )
    if product_ids:
        query = query.where(CatalogProduct.id.in_(product_ids))
    products = list((await db.execute(query.order_by(CatalogProduct.sort_order.asc()))).scalars().all())
    if not products:
        return {"synced": 0, "failed": 0, "total": 0, "pending": 0, "approved": 0, "rejected": 0}

    client = await _build_meta_client(db, account)
    synced = failed = pending = approved = rejected = 0
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
                    response = await client.update_catalog_product(
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
                try:
                    if product.external_id:
                        status_data = await client.get_catalog_product(product_id=product.external_id)
                    else:
                        status_data = response if isinstance(response, dict) else {}
                    apply_meta_product_status(product, data=status_data, sync_status="synced")
                except MetaAPIError:
                    apply_meta_product_status(product, sync_status="synced")
                synced += 1
                if product.meta_review_status == "pending":
                    pending += 1
                elif product.meta_review_status == "approved":
                    approved += 1
                elif product.meta_review_status == "rejected":
                    rejected += 1
            except MetaAPIError as exc:
                failed += 1
                apply_meta_product_status(
                    product,
                    sync_status="failed",
                    sync_error=str(exc),
                )
                errors.append(f"{product.name}: {exc}"[:500])
        account.catalog_synced_at = datetime.now(UTC)
        await db.commit()
    finally:
        await client.aclose()

    return {
        "synced": synced,
        "failed": failed,
        "total": len(products),
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "errors": errors[:20],
    }
