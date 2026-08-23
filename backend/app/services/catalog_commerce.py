"""WhatsApp Commerce helpers for internal catalog products."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog_product import CatalogProduct
from app.models.whatsapp_account import WhatsAppAccount
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient


def resolve_retailer_id(product: CatalogProduct) -> str:
    if product.meta_retailer_id and product.meta_retailer_id.strip():
        return product.meta_retailer_id.strip()
    if product.sku and product.sku.strip():
        return product.sku.strip()[:80]
    return str(product.id).replace("-", "")[:80]


def product_commerce_ready(product: CatalogProduct) -> bool:
    return product.is_active and bool(resolve_retailer_id(product))


def validate_product_for_meta_sync(product: CatalogProduct) -> str | None:
    """Return a user-facing Arabic error message, or None if the product can sync."""
    image_url = (product.image_url or "").strip()
    if not image_url:
        return "صورة المنتج مطلوبة للمزامنة مع Meta — ارفع صورة أو أدخل رابط HTTPS عام (500×500 على الأقل)."
    if not image_url.lower().startswith(("http://", "https://")):
        return "رابط صورة المنتج يجب أن يبدأ بـ http:// أو https://."
    if product.price is None or product.price <= 0:
        return "السعر مطلوب ويجب أن يكون أكبر من صفر للمزامنة مع Meta."
    if not (product.name or "").strip():
        return "اسم المنتج مطلوب للمزامنة مع Meta."
    if product.organization_id is None:
        return "حدّد فرع المنتج — كل فرع له رقم WhatsApp وكتالوج Meta منفصل."
    return None


def meta_sync_error_for_code(code: str) -> str:
    messages = {
        "ORGANIZATION_REQUIRED_FOR_META_SYNC": (
            "حدّد فرع المنتج — كل فرع له رقم WhatsApp وكتالوج Meta منفصل."
        ),
        "META_CATALOG_NOT_CONFIGURED_FOR_ORGANIZATION": (
            "فرع المنتج لا يملك Commerce أو Catalog ID — فعّلهما من إعدادات ربط WhatsApp لنفس الفرع."
        ),
        "ORGANIZATION_CATALOG_MISMATCH": (
            "فرع المنتج لا يطابق كتالوج WhatsApp المحدد."
        ),
        "META_CATALOG_NOT_CONFIGURED": (
            "فعّل Commerce وأدخل Meta Catalog ID من صفحة ربط WhatsApp."
        ),
    }
    return messages.get(code, code)


def product_matches_commerce_organization(product: CatalogProduct, whatsapp_account: WhatsAppAccount) -> bool:
    return product.organization_id is not None and product.organization_id == whatsapp_account.organization_id


def format_meta_sync_error(message: str) -> str:
    """Translate common Meta API errors to clearer Arabic guidance."""
    lower = message.lower()
    if "catalog_management" in lower or "manage_catalog" in lower:
        return (
            "توكن Meta لا يملك صلاحية catalog_management. "
            "أنشئ System User Token جديداً مع صلاحيات catalog_management و whatsapp_business_management."
        )
    if "invalid oauth access token" in lower or "session has expired" in lower:
        return "توكن Meta منتهي أو غير صالح — حدّث التوكن من إعدادات ربط WhatsApp."
    if "image_url" in lower and ("required" in lower or "missing" in lower):
        return "Meta تتطلب صورة للمنتج — ارفع صورة أو أدخل رابط HTTPS عام."
    if "image" in lower and ("fetch" in lower or "download" in lower or "invalid" in lower):
        return "Meta لم تستطع تحميل صورة المنتج — تأكد أن الرابط عام (HTTPS) وبحجم 500×500 على الأقل."
    if "permission" in lower or "does not exist" in lower or "unsupported post" in lower:
        return (
            "Meta رفض الوصول إلى الكتالوج — غالباً التوكن يفتقد صلاحية catalog_management "
            "أو Catalog ID لا يخص نفس Business. أنشئ System User Token جديداً مع catalog_management "
            "ثم حدّث الرمز من إعدادات ربط WhatsApp."
        )
    if "duplicate" in lower and "retailer" in lower:
        return "retailer_id مكرر في الكتالوج — غيّر SKU أو Meta retailer ID للمنتج."
    if "invalid partner" in lower:
        return (
            "Meta رفض ربط الكتالوج (Invalid partner). "
            "تأكد أن Catalog ID يخص نفس Business Portfolio لحساب WhatsApp، "
            "ثم من Meta Business Suite → Commerce Manager → الكتالوج → Partners "
            "أضف Watesly كشريك، أو اربط الكتالوج يدوياً من WhatsApp Manager → Settings → Catalog "
            "ثم أعد «تفعيل على Meta»."
        )
    if "nonexisting field" in lower and "metadata" in lower:
        return (
            "Meta لا يدعم قراءة metadata على Product Set بهذا الشكل — "
            "تم إصلاح المزامنة؛ أعد «تفعيل على Meta»."
        )
    return message


def _format_meta_price(product: CatalogProduct) -> str:
    if product.price is None:
        return "0.00"
    return f"{product.price:.2f}"


def build_meta_catalog_product_payload(product: CatalogProduct) -> dict:
    image_url = (product.image_url or "").strip()
    payload = {
        "name": product.name[:200],
        "description": (product.description or product.name)[:9999],
        "retailer_id": resolve_retailer_id(product),
        "price": str(int(float(_format_meta_price(product)) * 100)),
        "currency": product.currency or "KWD",
        "availability": "in stock",
        "condition": "new",
        "image_url": image_url,
    }
    group_id = (product.meta_item_group_id or "").strip()
    if group_id:
        payload["item_group_id"] = group_id[:80]
    size = (product.variant_size or "").strip()
    if size:
        payload["size"] = size[:100]
    color = (product.variant_color or "").strip()
    if color:
        payload["color"] = color[:100]
    extras = {
        str(key).strip(): str(value).strip()
        for key, value in (product.variant_attributes or {}).items()
        if str(key).strip() and str(value).strip()
    }
    if extras:
        payload["additional_variant_attributes"] = json.dumps(extras, ensure_ascii=False)
    return payload


async def list_catalog_variant_groups(db: AsyncSession, account_id: UUID) -> list[str]:
    rows = (
        await db.execute(
            select(CatalogProduct.meta_item_group_id)
            .where(
                CatalogProduct.account_id == account_id,
                CatalogProduct.is_active.is_(True),
                CatalogProduct.meta_item_group_id.is_not(None),
                CatalogProduct.meta_item_group_id != "",
            )
            .distinct()
            .order_by(CatalogProduct.meta_item_group_id.asc())
        )
    ).all()
    return [row[0] for row in rows if row[0]]


def account_commerce_ready(account: WhatsAppAccount) -> bool:
    return bool(account.commerce_enabled and account.meta_catalog_id)


def catalog_id_linked_to_waba(linked_catalogs: list[dict], catalog_id: str) -> bool:
    target = (catalog_id or "").strip()
    if not target:
        return False
    return any(
        str(row.get("id") or "").strip() == target
        for row in linked_catalogs
        if isinstance(row, dict)
    )


def is_catalog_link_skip_error(message: str) -> bool:
    lower = message.lower()
    return any(token in lower for token in ("already", "duplicate", "exists"))


def is_invalid_partner_catalog_error(message: str) -> bool:
    return "invalid partner" in message.lower()


async def ensure_meta_commerce_active(client: MetaWhatsAppClient, account: WhatsAppAccount) -> dict:
    """Link catalog to WABA and enable WhatsApp catalog visibility."""
    catalog_id = (account.meta_catalog_id or "").strip()
    if not catalog_id:
        raise ValueError("META_CATALOG_NOT_CONFIGURED")

    linked_catalogs = await client.list_waba_product_catalogs(waba_id=account.waba_id)
    catalog_already_linked = catalog_id_linked_to_waba(linked_catalogs, catalog_id)

    link_result: dict | None = None
    if not catalog_already_linked:
        try:
            link_result = await client.link_catalog_to_waba(
                waba_id=account.waba_id,
                catalog_id=catalog_id,
            )
        except MetaAPIError as exc:
            message = str(exc)
            if is_catalog_link_skip_error(message):
                link_result = {"skipped": True, "reason": message}
            elif is_invalid_partner_catalog_error(message):
                linked_catalogs = await client.list_waba_product_catalogs(waba_id=account.waba_id)
                if catalog_id_linked_to_waba(linked_catalogs, catalog_id):
                    link_result = {"already_linked": True}
                else:
                    raise ValueError(format_meta_sync_error(message)) from exc
            else:
                raise
    else:
        link_result = {"already_linked": True}

    commerce = await client.update_whatsapp_commerce_settings(
        is_catalog_visible=True,
        is_cart_enabled=True,
    )
    return {
        "catalog_linked": catalog_already_linked or link_result is not None,
        "commerce_settings": commerce,
    }


def parse_meta_catalog_visible(settings: dict | None) -> bool | None:
    if not settings:
        return None
    raw = settings.get("is_catalog_visible")
    if isinstance(raw, bool):
        return raw
    if raw is None:
        return None
    return str(raw).strip().lower() in {"true", "1", "yes"}


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
    from app.core.encryption import decrypt_secret
    from app.services.meta_client import MetaAPIError, MetaWhatsAppClient

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
    with_image = (
        await db.execute(
            select(func.count())
            .select_from(CatalogProduct)
            .where(
                CatalogProduct.account_id == account_id,
                CatalogProduct.is_active.is_(True),
                CatalogProduct.image_url.is_not(None),
                CatalogProduct.image_url != "",
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

    token_scopes: list[str] = []
    token_valid = None
    token_error: str | None = None
    has_catalog_management = False
    catalog_linked: bool | None = None
    is_catalog_visible: bool | None = None
    commerce_settings_error: str | None = None
    products_meta_synced = 0
    products_meta_pending = 0
    products_meta_approved = 0
    products_meta_rejected = 0
    try:
        client = MetaWhatsAppClient(
            access_token=decrypt_secret(account.access_token_encrypted),
            phone_number_id=account.phone_number_id,
        )
        try:
            debug = await client.debug_access_token()
            data = debug.get("data", debug)
            if isinstance(data, dict):
                token_valid = data.get("is_valid")
                scopes = data.get("scopes") or []
                token_scopes = [str(scope) for scope in scopes if scope]
                for scope in data.get("granular_scopes") or []:
                    if isinstance(scope, dict) and scope.get("scope"):
                        token_scopes.append(str(scope["scope"]))
                token_scopes = sorted(set(token_scopes))
                has_catalog_management = any(
                    "catalog" in scope.lower() for scope in token_scopes
                )
            if account_commerce_ready(account) and token_valid is not False:
                try:
                    linked_catalogs = await client.list_waba_product_catalogs(waba_id=account.waba_id)
                    catalog_linked = catalog_id_linked_to_waba(linked_catalogs, account.meta_catalog_id or "")
                    commerce_settings = await client.get_whatsapp_commerce_settings()
                    is_catalog_visible = parse_meta_catalog_visible(commerce_settings)
                except MetaAPIError as exc:
                    commerce_settings_error = format_meta_sync_error(str(exc))
        except MetaAPIError as exc:
            token_error = str(exc)
        finally:
            await client.aclose()
    except Exception as exc:
        token_error = str(exc)

    org_products = (
        await db.execute(
            select(CatalogProduct).where(
                CatalogProduct.account_id == account_id,
                CatalogProduct.is_active.is_(True),
                CatalogProduct.organization_id == account.organization_id,
                CatalogProduct.external_id.is_not(None),
                CatalogProduct.external_id != "",
            )
        )
    ).scalars().all()
    for product in org_products:
        products_meta_synced += 1
        if product.meta_review_status == "pending":
            products_meta_pending += 1
        elif product.meta_review_status in {"approved", "no_review"}:
            products_meta_approved += 1
        elif product.meta_review_status == "rejected":
            products_meta_rejected += 1

    return {
        "commerce_enabled": bool(account.commerce_enabled),
        "meta_catalog_id": account.meta_catalog_id,
        "catalog_synced_at": account.catalog_synced_at,
        "account_ready": account_commerce_ready(account),
        "products_active": int(total_active or 0),
        "products_with_retailer_id": int(with_retailer or 0),
        "products_with_image": int(with_image or 0),
        "token_valid": token_valid,
        "token_scopes": token_scopes,
        "has_catalog_management": has_catalog_management,
        "token_error": token_error,
        "catalog_linked": catalog_linked,
        "is_catalog_visible": is_catalog_visible,
        "commerce_settings_error": commerce_settings_error,
        "products_meta_synced": products_meta_synced,
        "products_meta_pending": products_meta_pending,
        "products_meta_approved": products_meta_approved,
        "products_meta_rejected": products_meta_rejected,
        "whatsapp_catalog_ready": bool(
            account_commerce_ready(account)
            and catalog_linked is True
            and is_catalog_visible is True
            and products_meta_approved > 0
        ),
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
