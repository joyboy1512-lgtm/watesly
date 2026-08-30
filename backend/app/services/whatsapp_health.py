"""Parse and sync WhatsApp Business account health from Meta."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient

TIER_DAILY_LIMITS: dict[str, int | None] = {
    "TIER_50": 50,
    "TIER_250": 250,
    "TIER_1K": 1_000,  # legacy / transitional
    "TIER_2K": 2_000,
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

META_HEALTH_STALE_AFTER = timedelta(minutes=10)


def tier_to_daily_limit(tier: str | None) -> int | None:
    if not tier:
        return None
    key = tier.upper().strip()
    if key in TIER_DAILY_LIMITS:
        return TIER_DAILY_LIMITS[key]
    # Accept numeric strings Meta may return in some payloads.
    if key.isdigit():
        return int(key)
    return None


def format_tier_hint(tier: str | None, limit: int | None) -> str:
    if tier == "TIER_UNLIMITED" or (tier and limit is None and tier.upper() == "TIER_UNLIMITED"):
        return "TIER_UNLIMITED: بدون حد يومي عملي"
    if tier and limit is not None:
        return f"{tier}: حتى {limit:,} محادثة فريدة/24س"
    if limit is not None:
        return f"حتى {limit:,} محادثة فريدة/24س"
    if tier:
        return f"{tier}: لم يُعرف الحد الرقمي بعد"
    return "لم تُزامَن الحدود من Meta بعد — اضغط مزامنة"


def resolve_effective_name_status(
    name_status: str | None,
    new_name_status: str | None,
) -> str | None:
    """Meta may keep name_status=DECLINED while new_name_status=APPROVED after a rename."""
    old = str(name_status).upper() if name_status else None
    new = str(new_name_status).upper() if new_name_status else None
    if new == "APPROVED":
        return "APPROVED"
    if old == "APPROVED":
        return "APPROVED"
    if new == "PENDING":
        return "PENDING"
    if old == "PENDING":
        return "PENDING"
    if old == "DECLINED":
        return "DECLINED"
    return new or old


def parse_phone_health(data: dict) -> dict:
    # Meta deprecated messaging_limit_tier in favor of portfolio-level field.
    tier = (
        data.get("whatsapp_business_manager_messaging_limit")
        or data.get("messaging_limit_tier")
        or data.get("messaging_limit")
    )
    tier_str = str(tier).upper().strip() if tier is not None and str(tier).strip() else None
    numeric_limit: int | None = None
    if tier_str and tier_str.isdigit():
        numeric_limit = int(tier_str)
        tier_str = None
    quality = data.get("quality_rating")
    limit = numeric_limit if numeric_limit is not None else (
        tier_to_daily_limit(tier_str) if tier_str else None
    )
    phone_status = data.get("status")
    name_status = data.get("name_status")
    new_name_status = data.get("new_name_status")
    effective_name_status = resolve_effective_name_status(name_status, new_name_status)
    return {
        "display_phone_number": data.get("display_phone_number"),
        "verified_name": data.get("verified_name"),
        "quality_rating": str(quality).upper() if quality else None,
        "messaging_limit_tier": tier_str,
        "messaging_limit": limit,
        "meta_phone_status": str(phone_status).upper() if phone_status else None,
        "meta_name_status": effective_name_status,
        "meta_new_name_status": str(new_name_status).upper() if new_name_status else None,
    }


def parse_waba_health(data: dict) -> dict:
    review = data.get("account_review_status")
    health = data.get("health_status") if isinstance(data.get("health_status"), dict) else {}
    can_send = health.get("can_send_message")
    entities = health.get("entities") if isinstance(health.get("entities"), list) else []
    waba_can_send = can_send
    for entity in entities:
        if isinstance(entity, dict) and entity.get("entity_type") == "WABA":
            waba_can_send = entity.get("can_send_message") or waba_can_send
            break
    return {
        "meta_account_review_status": str(review).upper() if review else None,
        "meta_can_send_message": str(waba_can_send).upper() if waba_can_send else None,
    }


def build_meta_status_message(
    *,
    meta_phone_status: str | None,
    meta_name_status: str | None,
    meta_can_send_message: str | None,
    meta_account_review_status: str | None,
) -> str:
    issues: list[str] = []
    can_send = (meta_can_send_message or "").upper()
    name_status = (meta_name_status or "").upper()
    phone_status = (meta_phone_status or "").upper()
    review_status = (meta_account_review_status or "").upper()

    if can_send == "BLOCKED":
        issues.append("Meta تعطّل الإرسال على هذا الحساب")
    elif can_send == "LIMITED":
        issues.append("Meta يقيّد الإرسال حالياً")
    if name_status == "DECLINED":
        issues.append("اسم العرض مرفوض — قد يظهر «معطّلاً» في Business Manager")
    elif name_status == "PENDING":
        issues.append("اسم العرض قيد مراجعة Meta")
    if phone_status and phone_status != "CONNECTED":
        issues.append(f"حالة الرقم في Meta: {phone_status}")
    if review_status and review_status not in {"APPROVED", ""}:
        issues.append(f"مراجعة WABA: {review_status}")

    if not issues:
        return "متاح — متطابق مع Meta"
    return " · ".join(issues)


def derive_account_status_from_meta(
    *,
    meta_phone_status: str | None,
    meta_can_send_message: str | None,
    meta_name_status: str | None,
    auth_error: bool = False,
) -> WhatsAppAccountStatus:
    if auth_error:
        return WhatsAppAccountStatus.DISCONNECTED
    can_send = (meta_can_send_message or "").upper()
    phone_status = (meta_phone_status or "").upper()
    name_status = (meta_name_status or "").upper()
    if can_send == "BLOCKED":
        return WhatsAppAccountStatus.SUSPENDED
    if name_status == "DECLINED":
        return WhatsAppAccountStatus.SUSPENDED
    if phone_status and phone_status not in {"CONNECTED", ""}:
        return WhatsAppAccountStatus.DISCONNECTED
    return WhatsAppAccountStatus.ACTIVE


def is_health_stale(whatsapp_account: WhatsAppAccount) -> bool:
    synced_at = whatsapp_account.health_synced_at
    if synced_at is None:
        return True
    if synced_at.tzinfo is None:
        synced_at = synced_at.replace(tzinfo=UTC)
    return datetime.now(UTC) - synced_at > META_HEALTH_STALE_AFTER


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
        phone_raw = await client.get_phone_number_health()
        phone_parsed = parse_phone_health(phone_raw)
        waba_parsed: dict = {}
        try:
            waba_raw = await client.get_waba_health(waba_id=whatsapp_account.waba_id)
            waba_parsed = parse_waba_health(waba_raw)
        except MetaAPIError:
            waba_parsed = {}
    except MetaAPIError as exc:
        whatsapp_account.health_synced_at = datetime.now(UTC)
        if _is_token_auth_error(exc):
            whatsapp_account.status = WhatsAppAccountStatus.DISCONNECTED
            whatsapp_account.meta_status_message = "تعذر المصادقة مع Meta — تحقق من Access Token"
        await db.commit()
        await db.refresh(whatsapp_account)
        raise
    finally:
        await client.aclose()

    meta_phone_status = phone_parsed.get("meta_phone_status")
    meta_name_status = phone_parsed.get("meta_name_status")
    meta_can_send_message = waba_parsed.get("meta_can_send_message")
    meta_account_review_status = waba_parsed.get("meta_account_review_status")

    if parsed_display := phone_parsed.get("display_phone_number"):
        whatsapp_account.display_phone_number = parsed_display
    if parsed_name := phone_parsed.get("verified_name"):
        whatsapp_account.verified_name = parsed_name
    whatsapp_account.quality_rating = phone_parsed.get("quality_rating")
    whatsapp_account.messaging_limit_tier = phone_parsed.get("messaging_limit_tier")
    whatsapp_account.messaging_limit = phone_parsed.get("messaging_limit")
    whatsapp_account.meta_phone_status = meta_phone_status
    whatsapp_account.meta_name_status = meta_name_status
    whatsapp_account.meta_can_send_message = meta_can_send_message
    whatsapp_account.meta_account_review_status = meta_account_review_status
    whatsapp_account.meta_status_message = build_meta_status_message(
        meta_phone_status=meta_phone_status,
        meta_name_status=meta_name_status,
        meta_can_send_message=meta_can_send_message,
        meta_account_review_status=meta_account_review_status,
    )
    whatsapp_account.status = derive_account_status_from_meta(
        meta_phone_status=meta_phone_status,
        meta_can_send_message=meta_can_send_message,
        meta_name_status=meta_name_status,
    )
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


async def refresh_stale_whatsapp_health(
    db: AsyncSession,
    *,
    whatsapp_accounts: list[WhatsAppAccount],
) -> None:
    for account in whatsapp_accounts:
        if is_health_stale(account):
            await sync_whatsapp_account_health_safe(db, whatsapp_account=account)
