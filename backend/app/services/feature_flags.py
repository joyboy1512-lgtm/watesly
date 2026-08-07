"""Account-level feature flags for safe rollout."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account

DEFAULT_FLAGS = {
    # Existing
    "ai_agent_auto_reply": True,
    "sla_monitoring": True,
    "privacy_mask_agents": True,
    "instagram_channel": False,
    "messenger_channel": False,
    "marketplace_installs": True,
    "http_automation_requests": True,
    # Phase A — growth (Meta-safe: off by default except read-only dashboard)
    "carousel_templates": False,
    "fast_campaigns": False,
    "ctwa_dashboard": True,
    "meta_capi": False,
    "follow_up_campaigns": False,
    # Phase B — automation & AI
    "no_code_bot_enhanced": False,
    "collect_input_forms": False,
    "ai_lead_agent": False,
    "ai_support_agent": False,
    # Phase C — ecommerce
    "shopify_integration": False,
    "woocommerce_integration": False,
    "order_templates": False,
}

FLAG_LABELS_AR: dict[str, str] = {
    "ai_agent_auto_reply": "رد تلقائي خارج ساعات العمل",
    "sla_monitoring": "مراقبة SLA",
    "privacy_mask_agents": "إخفاء الهاتف/البريد عن الموظفين",
    "instagram_channel": "قناة Instagram (تجريبي)",
    "messenger_channel": "قناة Messenger (تجريبي)",
    "marketplace_installs": "Marketplace — قوالب التكامل",
    "http_automation_requests": "طلبات HTTP في الأتمتة",
    "carousel_templates": "المرحلة A — قوالب Carousel",
    "fast_campaigns": "المرحلة A — إرسال حملات أسرع (batch)",
    "ctwa_dashboard": "المرحلة A — لوحة CTWA / Attribution",
    "meta_capi": "المرحلة A — Meta Conversions API",
    "follow_up_campaigns": "المرحلة A — حملات متابعة (follow-up)",
    "no_code_bot_enhanced": "المرحلة B — بوت no-code محسّن",
    "collect_input_forms": "المرحلة B — جمع بيانات (Forms)",
    "ai_lead_agent": "المرحلة B — AI Lead Agent",
    "ai_support_agent": "المرحلة B — AI Support Agent",
    "shopify_integration": "المرحلة C — Shopify",
    "woocommerce_integration": "المرحلة C — WooCommerce",
    "order_templates": "المرحلة C — قوالب رسائل الطلبات",
}


async def get_feature_flags(db: AsyncSession, *, account_id: UUID) -> dict:
    account = await db.get(Account, account_id)
    if account is None:
        return dict(DEFAULT_FLAGS)
    stored = account.feature_flags if isinstance(account.feature_flags, dict) else {}
    merged = dict(DEFAULT_FLAGS)
    merged.update(stored)
    return merged


async def update_feature_flags(
    db: AsyncSession,
    *,
    account_id: UUID,
    updates: dict,
) -> dict:
    account = await db.get(Account, account_id)
    if account is None:
        raise ValueError("ACCOUNT_NOT_FOUND")
    current = dict(account.feature_flags or {})
    current.update({key: value for key, value in updates.items() if key in DEFAULT_FLAGS})
    account.feature_flags = current
    await db.commit()
    await db.refresh(account)
    merged = dict(DEFAULT_FLAGS)
    merged.update(current)
    return merged


def feature_flags_metadata() -> dict:
    return {
        "defaults": dict(DEFAULT_FLAGS),
        "labels_ar": dict(FLAG_LABELS_AR),
    }
