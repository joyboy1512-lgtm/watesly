"""Parse and sync WhatsApp Business account health from Meta."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient

TIER_DAILY_LIMITS: dict[str, int | None] = {
    "TIER_50": 50,
    "TIER_250": 250,
    "TIER_1K": 1_000,
    "TIER_10K": 10_000,
    "TIER_100K": 100_000,
    "TIER_UNLIMITED": None,
}

QUALITY_LABELS_AR: dict[str, str] = {
    "GREEN": "ممتاز",
    "YELLOW": "متوسط — راقب الحملات",
    "RED": "منخفض — قلّل الإرسال",
    "UNKNOWN": "غير معروف",
}


def tier_to_daily_limit(tier: str | None) -> int | None:
    if not tier:
        return None
    return TIER_DAILY_LIMITS.get(tier.upper())


def format_tier_hint(tier: str | None, limit: int | None) -> str:
    if tier and limit:
        return f"{tier}: حتى {limit:,} محادثة فريدة/24س"
    if tier == "TIER_UNLIMITED":
        return "TIER_UNLIMITED: بدون حد يومي عملي"
    return "Tier 1: حتى 1,000 محادثة فريدة/24س (افتراضي قبل المزامنة)"


def parse_phone_health(data: dict) -> dict:
    tier = data.get("messaging_limit_tier") or data.get("messaging_limit")
    tier_str = str(tier).upper() if tier else None
    if tier_str and tier_str.isdigit():
        tier_str = None
    quality = data.get("quality_rating")
    limit = tier_to_daily_limit(tier_str) if tier_str else None
    return {
        "display_phone_number": data.get("display_phone_number"),
        "verified_name": data.get("verified_name"),
        "quality_rating": str(quality).upper() if quality else None,
        "messaging_limit_tier": tier_str,
        "messaging_limit": limit,
    }


def _is_token_auth_error(exc: MetaAPIError) -> bool:
    if exc.status_code in {401, 403}:
        return True
    response = exc.response_data if isinstance(exc.response_data, dict) else {}
    error = response.get("error", {}) if isinstance(response.get("error"), dict) else {}
    code = error.get("code")
    return code in {190, 102, 10}


async def inspect_whatsapp_access_token(
    *,
    access_token: str,
    phone_number_id: str,
) -> dict:
    client = MetaWhatsAppClient(access_token=access_token, phone_number_id=phone_number_id)
    try:
        await client.get_phone_number_health()
        return {"valid": True, "error": None}
    except MetaAPIError as exc:
        return {
            "valid": False,
            "error": str(exc),
            "auth_error": _is_token_auth_error(exc),
        }
    finally:
        await client.aclose()


async def sync_whatsapp_account_health(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
) -> WhatsAppAccount:
    client = MetaWhatsAppClient(
        access_token=decrypt_secret(whatsapp_account.access_token_encrypted),
        phone_number_id=whatsapp_account.phone_number_id,
    )
    try:
        raw = await client.get_phone_number_health()
        parsed = parse_phone_health(raw)
    except MetaAPIError as exc:
        whatsapp_account.health_synced_at = datetime.now(UTC)
        if _is_token_auth_error(exc):
            whatsapp_account.status = WhatsAppAccountStatus.DISCONNECTED
        await db.commit()
        await db.refresh(whatsapp_account)
        raise
    finally:
        await client.aclose()

    if parsed.get("display_phone_number"):
        whatsapp_account.display_phone_number = parsed["display_phone_number"]
    if parsed.get("verified_name"):
        whatsapp_account.verified_name = parsed["verified_name"]
    whatsapp_account.quality_rating = parsed.get("quality_rating")
    whatsapp_account.messaging_limit_tier = parsed.get("messaging_limit_tier")
    whatsapp_account.messaging_limit = parsed.get("messaging_limit")
    whatsapp_account.status = WhatsAppAccountStatus.ACTIVE
    whatsapp_account.health_synced_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(whatsapp_account)
    return whatsapp_account


async def sync_whatsapp_account_health_safe(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
) -> WhatsAppAccount:
    try:
        return await sync_whatsapp_account_health(db, whatsapp_account=whatsapp_account)
    except MetaAPIError:
        return whatsapp_account
