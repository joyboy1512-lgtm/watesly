"""WhatsApp Manager-style Account Tools: limits, pricing insights, Flows."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.message import Message, MessageDirection, MessageStatus, MessageType
from app.models.whatsapp_account import WhatsAppAccount
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.whatsapp_health import (
    QUALITY_LABELS_AR,
    format_tier_hint,
    sync_whatsapp_account_health,
    tier_to_daily_limit,
)

PRICING_CATEGORY_LABELS_AR: dict[str, str] = {
    "MARKETING": "تسويق",
    "MARKETING_LITE": "تسويق Lite",
    "UTILITY": "خدمات مساعدة",
    "AUTHENTICATION": "مصادقة",
    "AUTHENTICATION_INTERNATIONAL": "مصادقة دولية",
    "SERVICE": "خدمة",
    "REFERRAL_CONVERSION": "إحالة / نقطة دخول",
}

PRICING_TYPE_LABELS_AR: dict[str, str] = {
    "REGULAR": "مدفوع",
    "FREE_CUSTOMER_SERVICE": "مجاني — خدمة عملاء",
    "FREE_ENTRY_POINT": "مجاني — نقطة دخول",
}


def _client_for(account: WhatsAppAccount) -> MetaWhatsAppClient:
    return MetaWhatsAppClient(
        access_token=decrypt_secret(account.access_token_encrypted),
        phone_number_id=account.phone_number_id,
    )


def _unix(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp())


def _extract_data_points(payload: dict, root_key: str) -> list[dict]:
    root = payload.get(root_key)
    if not isinstance(root, dict):
        return []
    rows = root.get("data")
    if not isinstance(rows, list):
        return []
    points: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        data_points = row.get("data_points")
        if isinstance(data_points, list):
            points.extend(p for p in data_points if isinstance(p, dict))
        else:
            points.append(row)
    return points


def summarize_pricing_points(points: list[dict]) -> dict:
    by_category: dict[str, dict[str, float | int]] = {}
    by_pricing_type: dict[str, dict[str, float | int]] = {}
    total_volume = 0
    total_cost = 0.0
    free_volume = 0
    paid_volume = 0

    for point in points:
        category = str(point.get("pricing_category") or "UNKNOWN").upper()
        pricing_type = str(point.get("pricing_type") or "UNKNOWN").upper()
        volume = int(point.get("volume") or 0)
        cost = float(point.get("cost") or 0)
        total_volume += volume
        total_cost += cost
        if pricing_type.startswith("FREE"):
            free_volume += volume
        else:
            paid_volume += volume

        cat = by_category.setdefault(category, {"volume": 0, "cost": 0.0})
        cat["volume"] = int(cat["volume"]) + volume
        cat["cost"] = float(cat["cost"]) + cost

        ptype = by_pricing_type.setdefault(pricing_type, {"volume": 0, "cost": 0.0})
        ptype["volume"] = int(ptype["volume"]) + volume
        ptype["cost"] = float(ptype["cost"]) + cost

    categories = [
        {
            "key": key,
            "label_ar": PRICING_CATEGORY_LABELS_AR.get(key, key),
            "volume": int(vals["volume"]),
            "cost": round(float(vals["cost"]), 4),
        }
        for key, vals in sorted(by_category.items(), key=lambda item: -int(item[1]["volume"]))
    ]
    pricing_types = [
        {
            "key": key,
            "label_ar": PRICING_TYPE_LABELS_AR.get(key, key),
            "volume": int(vals["volume"]),
            "cost": round(float(vals["cost"]), 4),
        }
        for key, vals in sorted(by_pricing_type.items(), key=lambda item: -int(item[1]["volume"]))
    ]

    return {
        "delivered_total": total_volume,
        "delivered_free": free_volume,
        "delivered_paid": paid_volume,
        "approximate_cost": round(total_cost, 4),
        "currency": "USD",
        "by_category": categories,
        "by_pricing_type": pricing_types,
        "raw_points_count": len(points),
    }


def summarize_call_points(points: list[dict]) -> dict:
    total_count = 0
    total_cost = 0.0
    total_duration = 0.0
    duration_samples = 0
    by_direction: dict[str, int] = {}
    by_type: dict[str, int] = {}

    for point in points:
        count = int(point.get("count") or point.get("volume") or 0)
        cost = float(point.get("cost") or 0)
        avg_duration = point.get("average_duration")
        total_count += count
        total_cost += cost
        if avg_duration is not None:
            total_duration += float(avg_duration) * max(count, 1)
            duration_samples += max(count, 1)
        direction = str(point.get("direction") or "UNKNOWN").upper()
        call_type = str(point.get("call_type") or point.get("type") or "UNKNOWN").upper()
        by_direction[direction] = by_direction.get(direction, 0) + count
        by_type[call_type] = by_type.get(call_type, 0) + count

    return {
        "calls_total": total_count,
        "approximate_cost": round(total_cost, 4),
        "currency": "USD",
        "average_duration_seconds": (
            round(total_duration / duration_samples, 2) if duration_samples else None
        ),
        "by_direction": [
            {"key": key, "count": count}
            for key, count in sorted(by_direction.items(), key=lambda item: -item[1])
        ],
        "by_type": [
            {"key": key, "count": count}
            for key, count in sorted(by_type.items(), key=lambda item: -item[1])
        ],
        "raw_points_count": len(points),
    }


async def count_local_unique_outbound_contacts_24h(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
) -> int:
    """Local estimate of unique contacts messaged in the last 24h (outbound)."""
    since = datetime.now(UTC) - timedelta(hours=24)
    result = await db.scalar(
        select(func.count(func.distinct(Message.contact_id))).where(
            Message.account_id == account_id,
            Message.channel_id == channel_id,
            Message.direction == MessageDirection.OUTBOUND,
            Message.status.in_(
                [
                    MessageStatus.SENT,
                    MessageStatus.DELIVERED,
                    MessageStatus.READ,
                    MessageStatus.QUEUED,
                ]
            ),
            Message.created_at >= since,
            Message.contact_id.is_not(None),
        )
    )
    return int(result or 0)


async def count_local_outbound_messages(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    since: datetime,
    until: datetime,
    template_name: str | None = None,
) -> dict[str, int]:
    outbound_filters = [
        Message.account_id == account_id,
        Message.channel_id == channel_id,
        Message.direction == MessageDirection.OUTBOUND,
        Message.created_at >= since,
        Message.created_at < until,
    ]
    if template_name:
        outbound_filters.extend(
            [
                Message.type == MessageType.TEMPLATE,
                Message.provider_payload.contains({"template_name": template_name}),
            ]
        )

    sent = int((await db.scalar(select(func.count(Message.id)).where(*outbound_filters))) or 0)
    delivered = int(
        (
            await db.scalar(
                select(func.count(Message.id)).where(
                    *outbound_filters,
                    Message.status.in_([MessageStatus.DELIVERED, MessageStatus.READ]),
                )
            )
        )
        or 0
    )
    inbound_filters = [
        Message.account_id == account_id,
        Message.channel_id == channel_id,
        Message.direction == MessageDirection.INBOUND,
        Message.created_at >= since,
        Message.created_at < until,
    ]
    # Inbound is not template-scoped; keep full received unless a template filter is active.
    received = 0 if template_name else int(
        (await db.scalar(select(func.count(Message.id)).where(*inbound_filters))) or 0
    )
    return {"sent": sent, "delivered": delivered, "received": received}


async def get_messaging_limits_snapshot(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
    refresh: bool = False,
) -> dict:
    account = whatsapp_account
    if refresh or account.health_synced_at is None:
        account = await sync_whatsapp_account_health(db, whatsapp_account=account)

    tier = account.messaging_limit_tier
    limit = account.messaging_limit if account.messaging_limit is not None else tier_to_daily_limit(tier)
    used = await count_local_unique_outbound_contacts_24h(
        db,
        account_id=account.account_id,
        channel_id=account.channel_id,
    )
    remaining: int | None
    usage_ratio: float | None
    if limit is None:
        remaining = None
        usage_ratio = None
    else:
        remaining = max(0, limit - used)
        usage_ratio = round(used / limit, 4) if limit > 0 else None

    quality = (account.quality_rating or "UNKNOWN").upper()
    return {
        "whatsapp_account_id": account.id,
        "display_phone_number": account.display_phone_number,
        "verified_name": account.verified_name,
        "quality_rating": quality,
        "quality_label_ar": QUALITY_LABELS_AR.get(quality, quality),
        "messaging_limit_tier": tier,
        "messaging_limit": limit,
        "tier_hint_ar": format_tier_hint(tier, limit),
        "used_unique_contacts_24h": used,
        "remaining_unique_contacts_24h": remaining,
        "usage_ratio": usage_ratio,
        "meta_phone_status": account.meta_phone_status,
        "meta_can_send_message": account.meta_can_send_message,
        "meta_status_message": account.meta_status_message,
        "health_synced_at": account.health_synced_at,
        "usage_note_ar": (
            "الاستخدام محلي تقديري: عدد جهات اتصال فريدة أُرسل لها خلال آخر 24 ساعة. "
            "حد Meta الرسمي يُحسب لمحادثات فريدة بدأها النشاط التجاري."
        ),
    }


async def get_message_pricing_insights(
    db: AsyncSession,
    *,
    whatsapp_account: WhatsAppAccount,
    start: datetime,
    end: datetime,
    country_codes: list[str] | None = None,
    phone_numbers: list[str] | None = None,
    template_name: str | None = None,
) -> dict:
    local_counts = await count_local_outbound_messages(
        db,
        account_id=whatsapp_account.account_id,
        channel_id=whatsapp_account.channel_id,
        since=start,
        until=end,
        template_name=template_name,
    )
    client = _client_for(whatsapp_account)
    meta_error: str | None = None
    summary = summarize_pricing_points([])
    raw_points: list[dict] = []
    try:
        # Meta pricing analytics is WABA-scoped (not per-template). Keep full account
        # breakdown when browsing all templates; still return it for context when filtered.
        phones = phone_numbers
        if not phones and whatsapp_account.display_phone_number:
            digits = "".join(ch for ch in whatsapp_account.display_phone_number if ch.isdigit())
            phones = [digits] if digits else None
        payload = await client.get_pricing_analytics(
            waba_id=whatsapp_account.waba_id,
            start=_unix(start),
            end=_unix(end),
            phone_numbers=phones,
            country_codes=country_codes,
        )
        raw_points = _extract_data_points(payload, "pricing_analytics")
        summary = summarize_pricing_points(raw_points)
    except MetaAPIError as exc:
        meta_error = str(exc)
    finally:
        await client.aclose()

    note = (
        "رسوم Meta تقريبية حسب تسعير الرسائل. فوترة MAC داخل واتسلي منفصلة ولا تشمل رسوم Meta."
    )
    if template_name:
        note = (
            f"فلترة القالب «{template_name}»: بطاقات الإجمالي تعتمد على الإرسال المحلي لهذا القالب. "
            "تفصيل فئات Meta يبقى على مستوى الحساب لأن تسعير Meta لا يُقسَّم حسب اسم القالب."
        )

    return {
        "whatsapp_account_id": whatsapp_account.id,
        "waba_id": whatsapp_account.waba_id,
        "display_phone_number": whatsapp_account.display_phone_number,
        "start": start,
        "end": end,
        "template_name": template_name,
        "local_messages": local_counts,
        "meta": summary,
        "meta_error": meta_error,
        "source": "meta_pricing_analytics" if not meta_error else "local_fallback",
        "note_ar": note,
    }


async def get_call_pricing_insights(
    *,
    whatsapp_account: WhatsAppAccount,
    start: datetime,
    end: datetime,
    country_codes: list[str] | None = None,
    phone_numbers: list[str] | None = None,
) -> dict:
    client = _client_for(whatsapp_account)
    meta_error: str | None = None
    summary = summarize_call_points([])
    try:
        phones = phone_numbers
        if not phones and whatsapp_account.display_phone_number:
            digits = "".join(ch for ch in whatsapp_account.display_phone_number if ch.isdigit())
            phones = [digits] if digits else None
        payload = await client.get_call_analytics(
            waba_id=whatsapp_account.waba_id,
            start=_unix(start),
            end=_unix(end),
            phone_numbers=phones,
            country_codes=country_codes,
        )
        points = _extract_data_points(payload, "call_analytics")
        summary = summarize_call_points(points)
    except MetaAPIError as exc:
        meta_error = str(exc)
    finally:
        await client.aclose()

    return {
        "whatsapp_account_id": whatsapp_account.id,
        "waba_id": whatsapp_account.waba_id,
        "display_phone_number": whatsapp_account.display_phone_number,
        "start": start,
        "end": end,
        "meta": summary,
        "meta_error": meta_error,
        "source": "meta_call_analytics" if not meta_error else "unavailable",
        "note_ar": (
            "تسعير المكالمات يظهر فقط إن كان WhatsApp Calling مفعّلاً على الحساب ولديك صلاحية التحليلات."
        ),
    }


async def list_account_flows(*, whatsapp_account: WhatsAppAccount) -> dict:
    client = _client_for(whatsapp_account)
    meta_error: str | None = None
    flows: list[dict] = []
    try:
        flows = await client.list_flows(waba_id=whatsapp_account.waba_id)
    except MetaAPIError as exc:
        meta_error = str(exc)
    finally:
        await client.aclose()
    return {
        "whatsapp_account_id": whatsapp_account.id,
        "waba_id": whatsapp_account.waba_id,
        "flows": flows,
        "meta_error": meta_error,
        "note_ar": "الفلوز هنا هي WhatsApp Flows من Meta — مختلفة عن أتمتة واتسلي.",
    }


async def create_account_flow(
    *,
    whatsapp_account: WhatsAppAccount,
    name: str,
    categories: list[str] | None = None,
    endpoint_uri: str | None = None,
) -> dict:
    client = _client_for(whatsapp_account)
    try:
        created = await client.create_flow(
            waba_id=whatsapp_account.waba_id,
            name=name,
            categories=categories,
            endpoint_uri=endpoint_uri,
        )
    finally:
        await client.aclose()
    return created


async def send_account_flow_message(
    *,
    whatsapp_account: WhatsAppAccount,
    to: str,
    flow_id: str,
    flow_cta: str,
    body_text: str,
    flow_token: str | None = None,
    screen: str | None = None,
    header_text: str | None = None,
    footer_text: str | None = None,
) -> dict:
    client = _client_for(whatsapp_account)
    try:
        return await client.send_flow_message(
            to=to,
            flow_id=flow_id,
            flow_cta=flow_cta,
            body_text=body_text,
            flow_token=flow_token,
            screen=screen,
            header_text=header_text,
            footer_text=footer_text,
        )
    finally:
        await client.aclose()
