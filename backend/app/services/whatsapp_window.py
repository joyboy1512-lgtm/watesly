"""WhatsApp 24-hour customer service window helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message, MessageDirection

SERVICE_WINDOW_HOURS = 24


def compute_service_window(last_inbound_at: datetime | None) -> dict:
    now = datetime.now(UTC)
    if last_inbound_at is None:
        return {
            "last_inbound_at": None,
            "service_window_open": False,
            "service_window_expires_at": None,
            "requires_template": True,
        }
    if last_inbound_at.tzinfo is None:
        last_inbound_at = last_inbound_at.replace(tzinfo=UTC)
    expires_at = last_inbound_at + timedelta(hours=SERVICE_WINDOW_HOURS)
    window_open = now < expires_at
    return {
        "last_inbound_at": last_inbound_at,
        "service_window_open": window_open,
        "service_window_expires_at": expires_at if window_open else None,
        "requires_template": not window_open,
    }


async def get_last_inbound_by_conversation(
    db: AsyncSession,
    conversation_ids: list[UUID],
) -> dict[UUID, datetime]:
    if not conversation_ids:
        return {}
    result = await db.execute(
        select(Message.conversation_id, func.max(Message.created_at))
        .where(
            Message.conversation_id.in_(conversation_ids),
            Message.direction == MessageDirection.INBOUND,
        )
        .group_by(Message.conversation_id)
    )
    return {row[0]: row[1] for row in result.all()}


async def get_last_inbound_for_conversation(
    db: AsyncSession,
    conversation_id: UUID,
) -> datetime | None:
    result = await db.execute(
        select(func.max(Message.created_at)).where(
            Message.conversation_id == conversation_id,
            Message.direction == MessageDirection.INBOUND,
        )
    )
    return result.scalar_one_or_none()


async def get_last_inbound_by_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
) -> dict[UUID, datetime]:
    if not contact_ids:
        return {}
    result = await db.execute(
        select(Message.contact_id, func.max(Message.created_at))
        .where(
            Message.account_id == account_id,
            Message.contact_id.in_(contact_ids),
            Message.direction == MessageDirection.INBOUND,
        )
        .group_by(Message.contact_id)
    )
    return {row[0]: row[1] for row in result.all()}


async def campaign_audience_preflight(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
    template_category: str | None = None,
    whatsapp_account_id: UUID | None = None,
    template_components: list | None = None,
) -> dict:
    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.whatsapp_health import format_tier_hint

    last_inbound = await get_last_inbound_by_contact(db, account_id=account_id, contact_ids=contact_ids)
    never_messaged = 0
    window_open = 0
    window_closed = 0
    for contact_id in contact_ids:
        inbound_at = last_inbound.get(contact_id)
        if inbound_at is None:
            never_messaged += 1
            continue
        window = compute_service_window(inbound_at)
        if window["service_window_open"]:
            window_open += 1
        else:
            window_closed += 1

    warnings: list[str] = []
    category = (template_category or "").lower()
    if category == "marketing" and never_messaged:
        warnings.append(
            f"{never_messaged} عميل لم يراسلوك من قبل — تأكد من موافقة التسويق (opt-in)."
        )
    if never_messaged == len(contact_ids):
        warnings.append("كل المستلمين بلا محادثة سابقة — مناسب لقالب تسويقي فقط مع موافقة Meta.")

    tier_hint = format_tier_hint(None, None)
    quality_rating = None
    messaging_limit = None
    wa = None
    if whatsapp_account_id:
        wa = await db.get(WhatsAppAccount, whatsapp_account_id)
        if wa and wa.account_id == account_id:
            tier_hint = format_tier_hint(wa.messaging_limit_tier, wa.messaging_limit)
            quality_rating = wa.quality_rating
            messaging_limit = wa.messaging_limit
            if wa.messaging_limit and len(contact_ids) > wa.messaging_limit:
                warnings.append(
                    f"عدد المستلمين ({len(contact_ids)}) يتجاوز حد Tier الحالي ({wa.messaging_limit:,}/24س)."
                )
            if wa.quality_rating == "RED":
                warnings.append("جودة الحساب RED — قلّل الحملات التسويقية لتجنب تقييد Meta.")
            elif wa.quality_rating == "YELLOW":
                warnings.append("جودة الحساب YELLOW — راقب معدل الحظر والتقارير.")

    return {
        "total": len(contact_ids),
        "never_messaged": never_messaged,
        "window_open": window_open,
        "window_closed": window_closed,
        "template_required_all": True,
        "warnings": warnings,
        "checks": _build_preflight_checks(
            contact_ids=contact_ids,
            never_messaged=never_messaged,
            window_open=window_open,
            window_closed=window_closed,
            category=category,
            quality_rating=quality_rating,
            messaging_limit=messaging_limit,
            template_components=template_components,
        ),
        "messaging_tier_hint": tier_hint,
        "quality_rating": quality_rating,
        "messaging_limit": messaging_limit,
    }


def _build_preflight_checks(
    *,
    contact_ids: list,
    never_messaged: int,
    window_open: int,
    window_closed: int,
    category: str,
    quality_rating: str | None,
    messaging_limit: int | None,
    template_components: list | None = None,
) -> list[dict]:
    checks: list[dict] = []
    total = len(contact_ids)
    if total == 0:
        checks.append({"level": "error", "code": "empty_audience", "message": "لا يوجد مستلمون."})
    if never_messaged and category == "marketing":
        checks.append(
            {
                "level": "warning",
                "code": "cold_audience",
                "message": f"{never_messaged} عميل بدون محادثة سابقة — تأكد من opt-in.",
            }
        )
    if quality_rating == "RED":
        checks.append(
            {
                "level": "error",
                "code": "quality_red",
                "message": "جودة الحساب RED — يُفضّل تأجيل الحملة.",
            }
        )
    elif quality_rating == "YELLOW":
        checks.append(
            {
                "level": "warning",
                "code": "quality_yellow",
                "message": "جودة الحساب YELLOW — راقب معدل الحظر.",
            }
        )
    if messaging_limit and total > messaging_limit:
        checks.append(
            {
                "level": "error",
                "code": "tier_limit",
                "message": f"المستلمون ({total}) يتجاوزون حد Tier ({messaging_limit:,}/24س).",
            }
        )
    if template_components:
        from app.services.template_media import get_template_header_info

        header = get_template_header_info(template_components)
        if header and header.get("format") == "CAROUSEL":
            checks.append(
                {
                    "level": "info",
                    "code": "carousel_template",
                    "message": "قالب Carousel — البطاقات معرّفة في Meta؛ أرسل body variables فقط.",
                }
            )
    if window_open == total and category == "marketing":
        checks.append(
            {
                "level": "info",
                "code": "warm_audience",
                "message": "كل المستلمين داخل نافذة 24 ساعة — Utility قد يكون أرخص.",
            }
        )
    return checks
