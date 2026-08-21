"""Sync WhatsApp business profile photo and catalog cover to Meta."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount
from app.services.catalog_commerce import (
    account_commerce_ready,
    catalog_id_linked_to_waba,
    format_meta_sync_error,
    is_catalog_link_skip_error,
    is_invalid_partner_catalog_error,
)
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.storage import storage

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def _load_whatsapp_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
) -> WhatsAppAccount:
    account = await db.get(WhatsAppAccount, whatsapp_account_id)
    if account is None or account.account_id != account_id:
        raise ValueError("WHATSAPP_ACCOUNT_NOT_AVAILABLE")
    return account


def _meta_client(account: WhatsAppAccount) -> MetaWhatsAppClient:
    return MetaWhatsAppClient(
        access_token=decrypt_secret(account.access_token_encrypted),
        phone_number_id=account.phone_number_id,
    )


async def _ensure_meta_commerce_active(client: MetaWhatsAppClient, account: WhatsAppAccount) -> dict:
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


async def _fetch_image_bytes(url: str) -> tuple[bytes, str, str]:
    key = storage.key_from_public_url(url)
    if key:
        try:
            data = storage.download_bytes(key)
            if data:
                content_type = "image/jpeg"
                if url.lower().endswith(".png"):
                    content_type = "image/png"
                elif url.lower().endswith(".webp"):
                    content_type = "image/webp"
                extension = "jpg"
                if content_type == "image/png":
                    extension = "png"
                elif content_type == "image/webp":
                    extension = "webp"
                return data, content_type, f"watesly-brand.{extension}"
        except Exception:
            pass

    async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
        response = await client.get(url)
        if response.is_error:
            raise ValueError("PROFILE_IMAGE_FETCH_FAILED")
        content_type = (response.headers.get("content-type") or "image/jpeg").split(";")[0].strip().lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            content_type = "image/jpeg"
        data = response.content
        if not data:
            raise ValueError("PROFILE_IMAGE_FETCH_FAILED")
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("PROFILE_IMAGE_TOO_LARGE")
        extension = "jpg"
        if content_type == "image/png":
            extension = "png"
        elif content_type == "image/webp":
            extension = "webp"
        return data, content_type, f"watesly-brand.{extension}"


def _pick_product_set_id(account: WhatsAppAccount, product_sets: list[dict]) -> str:
    stored = (account.meta_catalog_product_set_id or "").strip()
    if stored and any(str(item.get("id")) == stored for item in product_sets):
        return stored
    for item in product_sets:
        name = str(item.get("name") or "").lower()
        if "all products" in name or name.startswith("all "):
            return str(item["id"])
    return str(product_sets[0]["id"])


async def update_whatsapp_branding_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    profile_image_url: str | None = None,
    catalog_cover_image_url: str | None = None,
) -> WhatsAppAccount:
    account = await _load_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )
    if profile_image_url is not None:
        account.profile_image_url = profile_image_url.strip() or None
    if catalog_cover_image_url is not None:
        account.catalog_cover_image_url = catalog_cover_image_url.strip() or None
    await db.commit()
    await db.refresh(account)
    return account


async def sync_profile_image_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
) -> dict:
    account = await _load_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )
    image_url = (account.profile_image_url or "").strip()
    if not image_url:
        raise ValueError("PROFILE_IMAGE_REQUIRED")

    file_bytes, mime_type, file_name = await _fetch_image_bytes(image_url)
    client = _meta_client(account)
    try:
        handle = await client.upload_resumable_file(
            file_name=file_name,
            file_bytes=file_bytes,
            mime_type=mime_type,
        )
        await client.update_whatsapp_business_profile(profile_picture_handle=handle)
        profile = await client.get_whatsapp_business_profile()
        account.profile_image_synced_at = datetime.now(UTC)
        await db.commit()
        return {
            "synced": True,
            "profile_image_url": image_url,
            "meta_profile_picture_url": profile.get("profile_picture_url"),
        }
    except MetaAPIError as exc:
        raise ValueError(format_meta_sync_error(str(exc))) from exc
    finally:
        await client.aclose()


async def sync_catalog_cover_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
) -> dict:
    account = await _load_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )
    if not account_commerce_ready(account):
        raise ValueError("META_CATALOG_NOT_CONFIGURED")

    cover_url = (account.catalog_cover_image_url or "").strip()
    if not cover_url:
        raise ValueError("CATALOG_COVER_REQUIRED")
    if not cover_url.lower().startswith("https://"):
        raise ValueError("CATALOG_COVER_HTTPS_REQUIRED")

    catalog_id = (account.meta_catalog_id or "").strip()
    client = _meta_client(account)
    try:
        commerce_result = await _ensure_meta_commerce_active(client, account)
        product_sets = await client.list_catalog_product_sets(catalog_id=catalog_id)
        if not product_sets:
            raise ValueError("META_PRODUCT_SET_NOT_FOUND")
        product_set_id = _pick_product_set_id(account, product_sets)
        await client.update_product_set_metadata(
            product_set_id=product_set_id,
            metadata={"cover_image_url": cover_url},
        )
        product_set = await client.get_product_set(product_set_id=product_set_id)
        live_metadata = product_set.get("live_metadata") or {}
        latest_metadata = product_set.get("metadata") or {}
        meta_cover_url = (
            live_metadata.get("cover_image_url")
            or latest_metadata.get("cover_image_url")
            or product_set.get("cover_image_url")
        )
        account.meta_catalog_product_set_id = product_set_id
        account.catalog_cover_synced_at = datetime.now(UTC)
        await db.commit()
        return {
            "synced": True,
            "cover_image_url": cover_url,
            "meta_cover_image_url": meta_cover_url,
            "product_set_id": product_set_id,
            "commerce_enabled_on_meta": True,
            "commerce_settings": commerce_result.get("commerce_settings"),
            "whatsapp_note": (
                "WhatsApp catalog header usually shows the business profile photo. "
                "This cover applies to Meta Shop collections."
            ),
        }
    except MetaAPIError as exc:
        raise ValueError(format_meta_sync_error(str(exc))) from exc
    finally:
        await client.aclose()


async def sync_whatsapp_commerce_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
) -> dict:
    account = await _load_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )
    if not account_commerce_ready(account):
        raise ValueError("META_CATALOG_NOT_CONFIGURED")

    client = _meta_client(account)
    try:
        result = await _ensure_meta_commerce_active(client, account)
        account.catalog_synced_at = datetime.now(UTC)
        await db.commit()
        return {"synced": True, **result}
    except MetaAPIError as exc:
        raise ValueError(format_meta_sync_error(str(exc))) from exc
    finally:
        await client.aclose()


async def sync_all_branding_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
) -> dict:
    profile_result: dict | None = None
    cover_result: dict | None = None
    errors: list[str] = []

    account = await _load_whatsapp_account(
        db,
        account_id=account_id,
        whatsapp_account_id=whatsapp_account_id,
    )
    if (account.profile_image_url or "").strip():
        try:
            profile_result = await sync_profile_image_to_meta(
                db,
                account_id=account_id,
                whatsapp_account_id=whatsapp_account_id,
            )
        except ValueError as exc:
            errors.append(str(exc))
    if (account.catalog_cover_image_url or "").strip() and account_commerce_ready(account):
        try:
            cover_result = await sync_catalog_cover_to_meta(
                db,
                account_id=account_id,
                whatsapp_account_id=whatsapp_account_id,
            )
        except ValueError as exc:
            errors.append(str(exc))
    elif account_commerce_ready(account):
        try:
            await sync_whatsapp_commerce_to_meta(
                db,
                account_id=account_id,
                whatsapp_account_id=whatsapp_account_id,
            )
        except ValueError as exc:
            errors.append(str(exc))

    if errors and not profile_result and not cover_result:
        raise ValueError(errors[0])

    return {
        "profile": profile_result,
        "catalog_cover": cover_result,
        "errors": errors,
    }
