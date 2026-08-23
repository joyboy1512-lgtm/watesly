"""Sync internal catalog products to Meta Commerce Catalog."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.catalog_product import CatalogProduct
from app.models.whatsapp_account import WhatsAppAccount
from app.services.catalog_commerce import (
    build_meta_catalog_product_payload,
    ensure_meta_commerce_active,
    format_meta_sync_error,
    meta_sync_error_for_code,
    product_matches_commerce_organization,
    resolve_retailer_id,
    validate_product_for_meta_sync,
)
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient


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


def _ensure_commerce_account_ready(account: WhatsAppAccount) -> None:
    if not account.commerce_enabled or not (account.meta_catalog_id or "").strip():
        raise ValueError("META_CATALOG_NOT_CONFIGURED")


async def _get_commerce_whatsapp_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> WhatsAppAccount:
    if whatsapp_account_id is not None:
        account = await db.get(WhatsAppAccount, whatsapp_account_id)
        if account is None or account.account_id != account_id:
            raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
        if organization_id is not None and account.organization_id != organization_id:
            raise ValueError("ORGANIZATION_CATALOG_MISMATCH")
        _ensure_commerce_account_ready(account)
        return account

    query = select(WhatsAppAccount).where(
        WhatsAppAccount.account_id == account_id,
        WhatsAppAccount.commerce_enabled.is_(True),
        WhatsAppAccount.meta_catalog_id.is_not(None),
        WhatsAppAccount.meta_catalog_id != "",
    )
    if organization_id is not None:
        query = query.where(WhatsAppAccount.organization_id == organization_id)

    account = (await db.execute(query.order_by(WhatsAppAccount.created_at.asc()).limit(1))).scalar_one_or_none()
    if account is None:
        if organization_id is not None:
            raise ValueError("META_CATALOG_NOT_CONFIGURED_FOR_ORGANIZATION")
        raise ValueError("META_CATALOG_NOT_CONFIGURED")
    return account


async def _build_meta_client(db: AsyncSession, account: WhatsAppAccount) -> MetaWhatsAppClient:
    return MetaWhatsAppClient(
        access_token=decrypt_secret(account.access_token_encrypted),
        phone_number_id=account.phone_number_id,
    )


def _require_product_organization(product: CatalogProduct) -> UUID:
    if product.organization_id is None:
        raise ValueError("ORGANIZATION_REQUIRED_FOR_META_SYNC")
    return product.organization_id


async def refresh_product_meta_status(
    client: MetaWhatsAppClient,
    product: CatalogProduct,
) -> bool:
    if not product.external_id:
        return False
    data = await client.get_catalog_product(product_id=product.external_id)
    apply_meta_product_status(product, data=data, sync_status="synced")
    return True


async def unpublish_catalog_product_from_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    product: CatalogProduct,
) -> None:
    if not product.external_id:
        return
    try:
        organization_id = _require_product_organization(product)
        account = await _get_commerce_whatsapp_account(
            db,
            account_id=account_id,
            organization_id=organization_id,
        )
    except ValueError:
        return
    client = await _build_meta_client(db, account)
    try:
        await client.update_catalog_product(
            product_id=product.external_id,
            payload={"availability": "out of stock"},
        )
    except MetaAPIError:
        pass
    finally:
        await client.aclose()


async def sync_catalog_product_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    product_id: UUID,
    membership=None,
    whatsapp_account_id: UUID | None = None,
) -> dict:
    from app.services.catalog import get_catalog_product

    product = await get_catalog_product(
        db,
        account_id=account_id,
        product_id=product_id,
        membership=membership,
    )
    if not product.is_active:
        raise ValueError("PRODUCT_NOT_ACTIVE")
    if not product.meta_sync_enabled:
        raise ValueError("META_SYNC_DISABLED")

    organization_id = _require_product_organization(product)
    account = await _get_commerce_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
        organization_id=organization_id,
    )
    return await sync_catalog_to_meta(
        db,
        account_id=account_id,
        whatsapp_account_id=account.id,
        product_ids=[product_id],
    )


async def _mark_product_meta_sync_failed(
    db: AsyncSession,
    *,
    product: CatalogProduct,
    code: str,
) -> None:
    apply_meta_product_status(
        product,
        sync_status="failed",
        sync_error=meta_sync_error_for_code(code),
    )
    await db.commit()


async def try_auto_sync_catalog_product_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    product: CatalogProduct,
    membership=None,
) -> None:
    """Push a product to Meta after local save when commerce is configured."""
    if not product.is_active or not product.meta_sync_enabled:
        return
    try:
        await sync_catalog_product_to_meta(
            db,
            account_id=account_id,
            product_id=product.id,
            membership=membership,
        )
    except ValueError as exc:
        code = str(exc)
        if code in {"META_SYNC_DISABLED", "PRODUCT_NOT_ACTIVE"}:
            return
        if code in {
            "META_CATALOG_NOT_CONFIGURED",
            "META_CATALOG_NOT_CONFIGURED_FOR_ORGANIZATION",
            "ORGANIZATION_REQUIRED_FOR_META_SYNC",
            "ORGANIZATION_CATALOG_MISMATCH",
        }:
            await _mark_product_meta_sync_failed(db, product=product, code=code)
            return
        raise


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
        CatalogProduct.organization_id == account.organization_id,
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
        CatalogProduct.meta_sync_enabled.is_(True),
        CatalogProduct.organization_id == account.organization_id,
    )
    if product_ids:
        query = query.where(CatalogProduct.id.in_(product_ids))
    products = list((await db.execute(query.order_by(CatalogProduct.sort_order.asc()))).scalars().all())
    if not products:
        return {"synced": 0, "failed": 0, "total": 0, "pending": 0, "approved": 0, "rejected": 0, "skipped": 0}

    client = await _build_meta_client(db, account)
    synced = failed = pending = approved = rejected = skipped = 0
    errors: list[str] = []
    commerce_activation: dict | None = None
    try:
        try:
            commerce_activation = await ensure_meta_commerce_active(client, account)
        except MetaAPIError as exc:
            activation_error = format_meta_sync_error(str(exc))
            return {
                "synced": 0,
                "failed": 0,
                "total": len(products),
                "pending": 0,
                "approved": 0,
                "rejected": 0,
                "skipped": len(products),
                "errors": [activation_error],
                "commerce_activation_failed": True,
            }
        except ValueError as exc:
            activation_error = format_meta_sync_error(str(exc))
            return {
                "synced": 0,
                "failed": 0,
                "total": len(products),
                "pending": 0,
                "approved": 0,
                "rejected": 0,
                "skipped": len(products),
                "errors": [activation_error],
                "commerce_activation_failed": True,
            }

        for product in products:
            if not product.meta_sync_enabled:
                continue
            if not product_matches_commerce_organization(product, account):
                skipped += 1
                mismatch_error = meta_sync_error_for_code("ORGANIZATION_CATALOG_MISMATCH")
                apply_meta_product_status(
                    product,
                    sync_status="failed",
                    sync_error=mismatch_error,
                )
                errors.append(f"{product.name}: {mismatch_error}"[:500])
                continue
            validation_error = validate_product_for_meta_sync(product)
            if validation_error:
                failed += 1
                apply_meta_product_status(
                    product,
                    sync_status="failed",
                    sync_error=validation_error,
                )
                errors.append(f"{product.name}: {validation_error}"[:500])
                continue
            payload = build_meta_catalog_product_payload(product)
            if not product.meta_retailer_id:
                product.meta_retailer_id = payload["retailer_id"]
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
                sync_error = format_meta_sync_error(str(exc))
                apply_meta_product_status(
                    product,
                    sync_status="failed",
                    sync_error=sync_error,
                )
                errors.append(f"{product.name}: {sync_error}"[:500])
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
        "skipped": skipped,
        "errors": errors[:20],
        "commerce_activated": commerce_activation is not None,
        "catalog_linked": (commerce_activation or {}).get("catalog_linked"),
    }
