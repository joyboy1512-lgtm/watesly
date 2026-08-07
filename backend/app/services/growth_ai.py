"""AI Lead Agent and Support Agent — gated by feature flags."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_assistant import detect_intent, extract_data
from app.services.feature_flags import get_feature_flags
from app.services.knowledge_base import get_agent_settings, suggest_smart_reply


async def run_lead_agent(
    db: AsyncSession,
    *,
    account_id: UUID,
    message: str,
    contact_name: str = "",
) -> dict:
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("ai_lead_agent"):
        return {"status": "disabled", "reason": "ai_lead_agent flag is off"}

    settings = await get_agent_settings(db, account_id)
    reply = await suggest_smart_reply(
        db,
        account_id=account_id,
        query=message,
        contact_name=contact_name,
        mode="combined",
        use_llm=settings.llm_enabled,
    )
    intent = detect_intent(message)
    extracted = extract_data(message)
    score = 0
    if intent.get("intent") in {"purchase", "pricing", "demo", "quote"}:
        score += 40
    if extracted.get("phone") or extracted.get("email"):
        score += 30
    if reply.get("confidence", 0) >= 0.5:
        score += 30
    qualified = score >= 60
    suggested_stage = "qualified" if qualified else "lead"
    return {
        "status": "ok",
        "qualified": qualified,
        "lead_score": min(score, 100),
        "suggested_lifecycle_stage": suggested_stage,
        "intent": intent,
        "extracted": extracted,
        "suggested_reply": reply.get("suggestion"),
        "source": reply.get("source"),
    }


async def run_support_agent(
    db: AsyncSession,
    *,
    account_id: UUID,
    message: str,
    contact_name: str = "",
) -> dict:
    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("ai_support_agent"):
        return {"status": "disabled", "reason": "ai_support_agent flag is off"}

    settings = await get_agent_settings(db, account_id)
    reply = await suggest_smart_reply(
        db,
        account_id=account_id,
        query=message,
        contact_name=contact_name,
        mode="kb_first",
        use_llm=settings.llm_enabled,
    )
    articles = reply.get("matched_articles") or []
    auto_resolvable = bool(articles) and reply.get("confidence", 0) >= 0.55
    return {
        "status": "ok",
        "auto_resolvable": auto_resolvable,
        "suggested_reply": reply.get("suggestion"),
        "matched_articles": articles[:5],
        "confidence": reply.get("confidence"),
        "escalate_to_human": not auto_resolvable,
    }
