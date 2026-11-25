"""Channel-scoped AI ops: effective settings, reply mode, activity log, dry-run lab."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_activity_event import AiActivityEvent
from app.models.ai_agent_channel_settings import AiAgentChannelSettings
from app.models.ai_agent_settings import AiAgentSettings
from app.models.ai_template_draft import AiTemplateDraft
from app.models.whatsapp_account import WhatsAppAccount
from app.services.business_hours import DEFAULT_HOURS, is_within_business_hours
from app.services.knowledge_base import (
    _account_llm_api_key,
    agent_llm_key_source,
    get_agent_settings,
    serialize_agent_settings,
    suggest_smart_reply,
    update_agent_settings,
)
from app.services.llm_client import llm_available

CHANNEL_OVERRIDE_FIELDS = (
    "agent_enabled",
    "local_engine_enabled",
    "llm_enabled",
    "auto_kb_on_inbound",
    "auto_reply_on_inbound",
    "default_mode",
    "tone",
    "language",
    "auto_reply_outside_hours",
    "business_hours_json",
    "outside_hours_message",
    "escalation_keywords",
    "clarify_max_rounds",
)

DEFAULT_ESCALATION_KEYWORDS = (
    "شكوى",
    "محامي",
    "محام",
    "بلوك",
    "استرجاع فلوسي",
    "استرجاع فلوس",
    "مدير",
    "مشكله كبيره",
    "مشكلة كبيرة",
    "complaint",
    "lawyer",
    "refund",
    "manager",
)


def normalize_keyword(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def matches_escalation_keywords(query: str, keywords: list[str] | None = None) -> str | None:
    text = normalize_keyword(query)
    if not text:
        return None
    pool = [normalize_keyword(item) for item in (keywords or list(DEFAULT_ESCALATION_KEYWORDS)) if item]
    for keyword in pool:
        if keyword and keyword in text:
            return keyword
    return None


def build_escalation_reply(*, contact_name: str = "", reason: str = "") -> dict:
    name = contact_name.strip() or "عميلنا"
    detail = f" ({reason})" if reason else ""
    return {
        "suggestion": (
            f"مرحباً {name}. تم تحويل محادثتك لموظف مختص{detail}. "
            "سيتابع معك في أقرب وقت ولن أكمل الرد الآلي في هذه المحادثة."
        ),
        "source": "escalate",
        "confidence": 1.0,
        "matched_articles": [],
        "matched_products": [],
        "needs_clarification": False,
        "engine": "escalation",
        "dialogue": {"escalated": True, "escalate_reason": reason or "keyword"},
        "reason_text": "تم تحويل المحادثة لموظف بسبب كلمة حساسة أو تعذّر التوضيح.",
    }


REASON_LABELS = {
    "staff_handles": "الموظف يرد على العميل — الذكاء لا يرسل ولا يقترح تلقائياً.",
    "suggest_only": "المساعد يقترح للموظف داخل الوارد دون إرسال للعميل.",
    "auto_reply": "المساعد يرد على العميل تلقائياً عند الرسائل الواردة.",
    "agent_off": "إيقاف الذكاء لجميع القنوات مفعّل.",
    "channel_agent_off": "الذكاء متوقف على هذه القناة.",
    "engines_off": "المحرك الداخلي والخارجي متوقفان — لا يوجد مصدر للرد.",
    "auto_reply_engines_off": "الرد التلقائي مطلوب لكن لا يوجد محرك جاهز. فعّل الداخلي أو الخارجي.",
    "local_off_llm_off": "المحرك المحلي متوقف ولا يوجد مزود خارجي جاهز.",
}


def phone_last4(phone: str | None) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return digits[-4:] if digits else "----"


def channel_label(wa: WhatsAppAccount | None) -> str:
    if wa is None:
        return "قناة غير معروفة"
    name = (wa.verified_name or "").strip() or "واتساب"
    return f"{name} · {phone_last4(wa.display_phone_number)}"


def compute_reply_mode(settings: dict[str, Any]) -> dict[str, Any]:
    """Return staff_handles | suggest_staff | auto_customer with Arabic copy + blockers."""
    account_kill = not bool(settings.get("account_agent_enabled", settings.get("agent_enabled", True)))
    agent_on = bool(settings.get("agent_enabled", True))
    local_on = bool(settings.get("local_engine_enabled", True))
    llm_on = bool(settings.get("llm_enabled", False)) and bool(settings.get("llm_available", False))
    engine_ready = local_on or llm_on
    auto_reply = bool(settings.get("auto_reply_on_inbound", False))
    suggest = bool(settings.get("auto_kb_on_inbound", True))

    blockers: list[dict[str, str]] = []
    if account_kill:
        return {
            "mode": "staff_handles",
            "label": "الموظف يرد",
            "reason_code": "agent_off",
            "reason_text": REASON_LABELS["agent_off"],
            "blockers": [{"code": "agent_off", "text": REASON_LABELS["agent_off"], "action": "شغّل «إيقاف الذكاء لجميع القنوات» إلى يعمل"}],
            "engine_ready": False,
        }
    if not agent_on:
        return {
            "mode": "staff_handles",
            "label": "الموظف يرد",
            "reason_code": "channel_agent_off",
            "reason_text": REASON_LABELS["channel_agent_off"],
            "blockers": [{"code": "channel_agent_off", "text": REASON_LABELS["channel_agent_off"], "action": "شغّل الذكاء لهذه القناة"}],
            "engine_ready": False,
        }
    if auto_reply and not engine_ready:
        blockers.append(
            {
                "code": "auto_reply_engines_off",
                "text": REASON_LABELS["auto_reply_engines_off"],
                "action": "فعّل المحرك الداخلي أو اربط مزوداً خارجياً",
            }
        )
        return {
            "mode": "staff_handles",
            "label": "الموظف يرد",
            "reason_code": "auto_reply_engines_off",
            "reason_text": REASON_LABELS["auto_reply_engines_off"],
            "blockers": blockers,
            "engine_ready": False,
        }
    if auto_reply and engine_ready:
        return {
            "mode": "auto_customer",
            "label": "المساعد يرد على العميل",
            "reason_code": "auto_reply",
            "reason_text": REASON_LABELS["auto_reply"],
            "blockers": [],
            "engine_ready": True,
        }
    if suggest and engine_ready:
        return {
            "mode": "suggest_staff",
            "label": "المساعد يقترح للموظف",
            "reason_code": "suggest_only",
            "reason_text": REASON_LABELS["suggest_only"],
            "blockers": [],
            "engine_ready": True,
        }
    if suggest and not engine_ready:
        blockers.append(
            {
                "code": "engines_off",
                "text": REASON_LABELS["engines_off"],
                "action": "فعّل الداخلي أو الخارجي ثم أعد المحاولة",
            }
        )
    return {
        "mode": "staff_handles",
        "label": "الموظف يرد",
        "reason_code": "staff_handles",
        "reason_text": REASON_LABELS["staff_handles"],
        "blockers": blockers,
        "engine_ready": engine_ready,
    }


async def get_channel_override(
    db: AsyncSession, *, account_id: UUID, channel_id: UUID
) -> AiAgentChannelSettings | None:
    return (
        await db.execute(
            select(AiAgentChannelSettings).where(
                AiAgentChannelSettings.account_id == account_id,
                AiAgentChannelSettings.channel_id == channel_id,
            )
        )
    ).scalar_one_or_none()


async def get_or_create_channel_override(
    db: AsyncSession, *, account_id: UUID, channel_id: UUID
) -> AiAgentChannelSettings:
    item = await get_channel_override(db, account_id=account_id, channel_id=channel_id)
    if item is None:
        item = AiAgentChannelSettings(account_id=account_id, channel_id=channel_id)
        db.add(item)
        await db.commit()
        await db.refresh(item)
    return item


def merge_effective_settings(
    account: AiAgentSettings,
    override: AiAgentChannelSettings | None = None,
) -> dict[str, Any]:
    base = serialize_agent_settings(account)
    base["account_agent_enabled"] = bool(getattr(account, "agent_enabled", True))
    base["channel_id"] = str(override.channel_id) if override else None
    base["has_channel_override"] = override is not None
    base["inherited_fields"] = []
    base["override_fields"] = []
    base["escalation_keywords"] = []
    base["clarify_max_rounds"] = 2

    if override is None:
        base["inherited_fields"] = list(CHANNEL_OVERRIDE_FIELDS)
        reply = compute_reply_mode(base)
        base["reply_mode"] = reply
        return base

    for field in CHANNEL_OVERRIDE_FIELDS:
        value = getattr(override, field, None)
        if value is None:
            base["inherited_fields"].append(field)
            continue
        base["override_fields"].append(field)
        if field == "escalation_keywords":
            base[field] = value if isinstance(value, list) else []
        else:
            base[field] = value

    # Account kill switch always wins
    if not base["account_agent_enabled"]:
        base["agent_enabled"] = False

    account_key = _account_llm_api_key(account)
    base["llm_available"] = llm_available(api_key=account_key)
    base["llm_key_configured"] = bool(account_key)
    base["llm_key_source"] = agent_llm_key_source(account)
    hours = base.get("business_hours_json") or DEFAULT_HOURS
    base["within_business_hours"] = is_within_business_hours(hours if isinstance(hours, dict) else DEFAULT_HOURS)
    base["reply_mode"] = compute_reply_mode(base)
    return base


async def get_effective_agent_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID | None = None,
) -> dict[str, Any]:
    account = await get_agent_settings(db, account_id)
    override = None
    if channel_id is not None:
        override = await get_channel_override(db, account_id=account_id, channel_id=channel_id)
    return merge_effective_settings(account, override)


async def update_channel_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    fields: dict[str, Any],
) -> dict[str, Any]:
    item = await get_or_create_channel_override(db, account_id=account_id, channel_id=channel_id)
    for key, value in fields.items():
        if key not in CHANNEL_OVERRIDE_FIELDS:
            continue
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    account = await get_agent_settings(db, account_id)
    return merge_effective_settings(account, item)


async def update_account_kill_switch(
    db: AsyncSession, *, account_id: UUID, agent_enabled: bool
) -> dict[str, Any]:
    item = await update_agent_settings(db, account_id, agent_enabled=agent_enabled)
    return serialize_agent_settings(item)


async def log_ai_activity(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID | None,
    conversation_id: UUID | None = None,
    source: str,
    outcome: str,
    reason_code: str | None = None,
    reason_text: str | None = None,
    query_text: str | None = None,
    suggestion: str | None = None,
    engine: str | None = None,
    meta: dict | None = None,
) -> AiActivityEvent:
    event = AiActivityEvent(
        account_id=account_id,
        channel_id=channel_id,
        conversation_id=conversation_id,
        source=source,
        outcome=outcome,
        reason_code=reason_code,
        reason_text=reason_text,
        query_text=(query_text or "")[:4000] or None,
        suggestion=(suggestion or "")[:4000] or None,
        engine=engine,
        meta_json=meta or {},
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def list_ai_activity(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID | None = None,
    source: str | None = None,
    limit: int = 50,
) -> list[AiActivityEvent]:
    query = select(AiActivityEvent).where(AiActivityEvent.account_id == account_id)
    if channel_id is not None:
        query = query.where(AiActivityEvent.channel_id == channel_id)
    if source:
        query = query.where(AiActivityEvent.source == source)
    query = query.order_by(desc(AiActivityEvent.created_at)).limit(limit)
    return list((await db.execute(query)).scalars().all())


async def ai_activity_metrics(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID | None = None,
    days: int = 7,
) -> dict[str, Any]:
    since = datetime.now(UTC) - timedelta(days=max(1, days))
    query = select(AiActivityEvent).where(
        AiActivityEvent.account_id == account_id,
        AiActivityEvent.created_at >= since,
        AiActivityEvent.source == "live",
    )
    if channel_id is not None:
        query = query.where(AiActivityEvent.channel_id == channel_id)
    rows = list((await db.execute(query)).scalars().all())
    total = len(rows)
    by_outcome: dict[str, int] = {}
    for row in rows:
        by_outcome[row.outcome] = by_outcome.get(row.outcome, 0) + 1
    return {
        "days": days,
        "total": total,
        "by_outcome": by_outcome,
        "suggest_count": by_outcome.get("suggest_staff", 0),
        "auto_reply_count": by_outcome.get("auto_customer", 0),
        "escalate_count": by_outcome.get("escalate", 0),
        "skip_count": by_outcome.get("skip", 0),
        "fail_count": by_outcome.get("fail", 0),
        "unresolved_count": by_outcome.get("unresolved", 0),
    }


async def run_lab_turn(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    query: str,
    contact_name: str = "",
    dialogue_state: dict | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    settings = await get_effective_agent_settings(db, account_id=account_id, channel_id=channel_id)
    result = await suggest_smart_reply(
        db,
        account_id=account_id,
        query=query,
        contact_name=contact_name,
        mode=settings.get("default_mode") or "kb_first",
        use_llm=bool(settings.get("llm_enabled")),
        channel_id=channel_id,
        dialogue_state=dialogue_state,
    )
    # Cap displayed confidence to 100% for UI clarity
    confidence = result.get("confidence")
    if isinstance(confidence, (int, float)):
        result["confidence"] = max(0.0, min(1.0, float(confidence)))
        result["confidence_pct"] = round(result["confidence"] * 100)

    reply_mode = settings.get("reply_mode") or compute_reply_mode(settings)
    outcome = "lab_suggest"
    if result.get("needs_clarification"):
        outcome = "lab_clarify"
    if result.get("dialogue", {}).get("escalated"):
        outcome = "lab_escalate"

    understood = {
        "source": result.get("source"),
        "engine": result.get("engine"),
        "matched_products": result.get("matched_products") or [],
        "matched_articles": result.get("matched_articles") or [],
        "dialogue": result.get("dialogue"),
        "needs_clarification": result.get("needs_clarification"),
        "confidence_pct": result.get("confidence_pct"),
    }
    reason_text = result.get("reason_text")
    if not reason_text:
        if result.get("needs_clarification"):
            reason_text = "يحتاج توضيحاً قبل الإضافة للسلة."
        elif (result.get("matched_products") or []):
            reason_text = "مطابقة من كتالوج القناة."
        elif (result.get("matched_articles") or []):
            reason_text = "مطابقة من قاعدة معرفة القناة."
        else:
            reason_text = "لم تُوجد مطابقة قوية في نطاق هذه القناة."

    event = await log_ai_activity(
        db,
        account_id=account_id,
        channel_id=channel_id,
        source="lab" if dry_run else "live",
        outcome=outcome,
        reason_code=str(result.get("source") or "lab"),
        reason_text=reason_text,
        query_text=query,
        suggestion=result.get("suggestion"),
        engine=result.get("engine"),
        meta={"dry_run": dry_run, "understood": understood, "reply_mode": reply_mode},
    )
    return {
        "dry_run": dry_run,
        "whatsapp_sent": False,
        "order_created": False,
        "reply_mode": reply_mode,
        "customer_reply": result.get("suggestion"),
        "understood": understood,
        "reason_text": reason_text,
        "dialogue": result.get("dialogue"),
        "raw": result,
        "activity_id": str(event.id),
    }


def serialize_activity(event: AiActivityEvent) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "channel_id": str(event.channel_id) if event.channel_id else None,
        "conversation_id": str(event.conversation_id) if event.conversation_id else None,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "source": event.source,
        "outcome": event.outcome,
        "reason_code": event.reason_code,
        "reason_text": event.reason_text,
        "query_text": event.query_text,
        "suggestion": event.suggestion,
        "engine": event.engine,
        "meta": event.meta_json or {},
    }


def serialize_template_draft(item: AiTemplateDraft) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "channel_id": str(item.channel_id),
        "whatsapp_account_id": str(item.whatsapp_account_id) if item.whatsapp_account_id else None,
        "status": item.status,
        "topic": item.topic,
        "angle": item.angle,
        "draft": item.draft_json or {},
        "internal_check": item.internal_check_json or {},
        "meta_status": item.meta_status,
        "template_id": str(item.template_id) if item.template_id else None,
        "notes": item.notes,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


async def list_template_drafts(
    db: AsyncSession, *, account_id: UUID, channel_id: UUID
) -> list[AiTemplateDraft]:
    rows = await db.execute(
        select(AiTemplateDraft)
        .where(
            AiTemplateDraft.account_id == account_id,
            AiTemplateDraft.channel_id == channel_id,
        )
        .order_by(desc(AiTemplateDraft.updated_at))
    )
    return list(rows.scalars().all())


def internal_template_check(draft: dict[str, Any]) -> dict[str, Any]:
    body = str(draft.get("body_text") or "")
    name = str(draft.get("name") or "")
    issues: list[str] = []
    if not name:
        issues.append("اسم القالب مطلوب")
    if not body.strip():
        issues.append("نص القالب فارغ")
    if len(body) > 1024:
        issues.append("نص القالب أطول من حد ميتا التقريبي (1024)")
    buttons = draft.get("buttons") or []
    if isinstance(buttons, list) and len(buttons) > 3:
        issues.append("أكثر من 3 أزرار")
    return {"ok": not issues, "issues": issues, "stage": "internal"}
