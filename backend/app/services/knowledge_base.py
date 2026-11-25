"""Knowledge base search, smart reply, import/export, and agent settings."""

from __future__ import annotations

import csv
import io
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret, encrypt_secret
from app.models.ai_agent_settings import AiAgentSettings
from app.models.knowledge_article import KnowledgeArticle
from app.services.ai_assistant import (
    detect_emotion,
    detect_intent,
    suggest_reply,
    summarize_conversation,
)
from app.services.business_hours import DEFAULT_HOURS, is_within_business_hours
from app.services.catalog import build_catalog_reply, search_catalog_products, suggest_catalog_reply
from app.services.internal_ai import (
    build_multi_article_body,
    complementary_articles,
    evaluate_cases,
    expand_query_terms,
    rank_articles,
)
from app.services.llm_client import enhance_reply, llm_available


def _account_llm_api_key(item: AiAgentSettings) -> str | None:
    raw = (item.llm_api_key_encrypted or "").strip()
    if not raw:
        return None
    try:
        return decrypt_secret(raw)
    except ValueError:
        return None


def agent_llm_key_source(item: AiAgentSettings) -> str:
    if _account_llm_api_key(item):
        return "account"
    if llm_available():
        return "env"
    return "none"


def serialize_agent_settings(item: AiAgentSettings) -> dict:
    account_key = _account_llm_api_key(item)
    key_source = agent_llm_key_source(item)
    hours = item.business_hours_json or {}
    return {
        "default_mode": item.default_mode,
        "tone": item.tone,
        "language": item.language,
        "agent_enabled": bool(getattr(item, "agent_enabled", True)),
        "local_engine_enabled": bool(getattr(item, "local_engine_enabled", True)),
        "llm_enabled": item.llm_enabled,
        "auto_kb_on_inbound": item.auto_kb_on_inbound,
        "auto_reply_on_inbound": bool(getattr(item, "auto_reply_on_inbound", False)),
        "llm_system_prompt": item.llm_system_prompt,
        "auto_reply_outside_hours": item.auto_reply_outside_hours,
        "business_hours_json": hours if hours else dict(DEFAULT_HOURS),
        "outside_hours_message": item.outside_hours_message,
        "welcome_message_enabled": bool(getattr(item, "welcome_message_enabled", False)),
        "welcome_message": getattr(item, "welcome_message", None),
        "llm_api_base_url": item.llm_api_base_url,
        "llm_model": item.llm_model,
        "llm_image_model": getattr(item, "llm_image_model", None),
        "llm_available": llm_available(api_key=account_key),
        "llm_key_configured": bool(account_key),
        "llm_key_source": key_source,
        "within_business_hours": is_within_business_hours(hours or DEFAULT_HOURS),
    }


async def get_agent_settings(db: AsyncSession, account_id: UUID) -> AiAgentSettings:
    item = (
        await db.execute(select(AiAgentSettings).where(AiAgentSettings.account_id == account_id))
    ).scalar_one_or_none()
    if item is None:
        item = AiAgentSettings(account_id=account_id)
        db.add(item)
        await db.commit()
        await db.refresh(item)
    return item


async def update_agent_settings(db: AsyncSession, account_id: UUID, **fields) -> AiAgentSettings:
    item = await get_agent_settings(db, account_id)

    if "llm_api_key" in fields:
        raw_key = fields.pop("llm_api_key")
        if raw_key is None:
            pass
        elif str(raw_key).strip() == "":
            item.llm_api_key_encrypted = None
        else:
            item.llm_api_key_encrypted = encrypt_secret(str(raw_key).strip())

    if fields.pop("clear_llm_api_key", False):
        item.llm_api_key_encrypted = None

    for key, value in fields.items():
        if key == "llm_api_key_encrypted":
            continue
        if hasattr(item, key):
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


def _apply_knowledge_channel_filter(query, *, channel_id: UUID | None, strict: bool):
    """Isolate articles per WhatsApp channel.

    strict=True (inbound AI): only articles assigned to this channel.
    strict=False (admin list): channel filter includes unassigned when requested via include_unassigned.
    """
    if channel_id is None:
        return query
    if strict:
        return query.where(KnowledgeArticle.channel_id == channel_id)
    return query.where(
        or_(
            KnowledgeArticle.channel_id == channel_id,
            KnowledgeArticle.channel_id.is_(None),
        )
    )


async def list_knowledge_articles(
    db: AsyncSession,
    account_id: UUID,
    *,
    active_only: bool = True,
    category: str | None = None,
    channel_id: UUID | None = None,
    strict_channel: bool = False,
    unassigned_only: bool = False,
) -> list[KnowledgeArticle]:
    query = select(KnowledgeArticle).where(KnowledgeArticle.account_id == account_id)
    if active_only:
        query = query.where(KnowledgeArticle.is_active.is_(True))
    if category:
        query = query.where(KnowledgeArticle.category == category)
    if unassigned_only:
        query = query.where(KnowledgeArticle.channel_id.is_(None))
    else:
        query = _apply_knowledge_channel_filter(
            query, channel_id=channel_id, strict=strict_channel
        )
    query = query.order_by(KnowledgeArticle.sort_order.asc(), KnowledgeArticle.title.asc())
    return list((await db.execute(query)).scalars().all())


async def list_knowledge_categories(
    db: AsyncSession,
    account_id: UUID,
    *,
    channel_id: UUID | None = None,
    strict_channel: bool = False,
) -> list[str]:
    query = select(KnowledgeArticle.category).where(
        KnowledgeArticle.account_id == account_id,
        KnowledgeArticle.is_active.is_(True),
    )
    query = _apply_knowledge_channel_filter(query, channel_id=channel_id, strict=strict_channel)
    rows = (
        await db.execute(query.distinct().order_by(KnowledgeArticle.category.asc()))
    ).all()
    return [row[0] for row in rows if row[0]]


async def search_knowledge_ranked(
    db: AsyncSession,
    account_id: UUID,
    query_text: str,
    *,
    limit: int = 5,
    channel_id: UUID | None = None,
    strict_channel: bool = True,
):
    """Rank active knowledge articles with the internal AI scorer (channel-scoped)."""
    if not query_text.strip():
        articles = await list_knowledge_articles(
            db,
            account_id,
            channel_id=channel_id,
            strict_channel=strict_channel,
        )
        return rank_articles(articles, query_text, limit=limit, min_score=0.0)[:limit]

    all_active = await list_knowledge_articles(
        db,
        account_id,
        channel_id=channel_id,
        strict_channel=strict_channel,
    )
    # Prefer a widened SQL prefilter when the account has many articles, then re-rank.
    if len(all_active) > 80:
        raw_terms = {query_text.strip()}
        raw_terms |= expand_query_terms(query_text)
        candidates: dict[str, KnowledgeArticle] = {str(item.id): item for item in all_active}
        narrowed: dict[str, KnowledgeArticle] = {}
        for term in list(raw_terms)[:12]:
            if len(term) < 2:
                continue
            pattern = f"%{term}%"
            filters = [
                KnowledgeArticle.account_id == account_id,
                KnowledgeArticle.is_active.is_(True),
                or_(
                    KnowledgeArticle.title.ilike(pattern),
                    KnowledgeArticle.body.ilike(pattern),
                    KnowledgeArticle.keywords.ilike(pattern),
                ),
            ]
            stmt = select(KnowledgeArticle).where(*filters)
            stmt = _apply_knowledge_channel_filter(
                stmt, channel_id=channel_id, strict=strict_channel
            )
            rows = list((await db.execute(stmt)).scalars().all())
            for row in rows:
                narrowed[str(row.id)] = row
        pool = list(narrowed.values()) or list(candidates.values())
    else:
        pool = all_active
    return rank_articles(pool, query_text, limit=limit)


async def search_knowledge_articles(
    db: AsyncSession,
    account_id: UUID,
    query_text: str,
    *,
    limit: int = 5,
    channel_id: UUID | None = None,
    strict_channel: bool = True,
) -> list[KnowledgeArticle]:
    ranked = await search_knowledge_ranked(
        db,
        account_id,
        query_text,
        limit=limit,
        channel_id=channel_id,
        strict_channel=strict_channel,
    )
    return [item.article for item in ranked]


async def increment_article_usage(db: AsyncSession, article: KnowledgeArticle) -> None:
    article.usage_count = (article.usage_count or 0) + 1
    await db.commit()


async def record_article_feedback(
    db: AsyncSession,
    article: KnowledgeArticle,
    *,
    helpful: bool,
) -> KnowledgeArticle:
    if helpful:
        article.helpful_count = int(article.helpful_count or 0) + 1
        article.usage_count = int(article.usage_count or 0) + 1
    else:
        article.dismiss_count = int(article.dismiss_count or 0) + 1
    await db.commit()
    await db.refresh(article)
    return article


def build_knowledge_reply(
    articles: list[KnowledgeArticle],
    *,
    contact_name: str = "",
    query: str = "",
    contact_context: dict | None = None,
    scored: list | None = None,
) -> dict:
    if not articles and not scored:
        return {}
    ranked = scored or rank_articles(articles, query, limit=max(3, len(articles)), min_score=0.0)
    if not ranked:
        return {}
    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    body, confidence = build_multi_article_body(ranked, contact_context=contact_context)
    extras = complementary_articles(ranked)
    used = [ranked[0], *extras]
    return {
        "suggestion": f"{greeting}{body}".strip(),
        "matched_articles": [
            {
                "id": str(item.article.id),
                "title": item.article.title,
                "category": item.article.category,
                "body": (item.article.body or "")[:220],
                "score": item.score,
                "reasons": item.reasons,
                "helpful_count": int(getattr(item.article, "helpful_count", 0) or 0),
                "dismiss_count": int(getattr(item.article, "dismiss_count", 0) or 0),
            }
            for item in used
        ],
        "confidence": confidence,
        "source": "knowledge_base",
        "query": query,
        "expanded_terms": sorted(expand_query_terms(query))[:20],
        "engine": "internal_v2",
    }


async def evaluate_knowledge_quality(
    db: AsyncSession,
    account_id: UUID,
    cases: list[dict],
    *,
    limit: int = 5,
) -> dict:
    articles = await list_knowledge_articles(db, account_id, active_only=True)
    return evaluate_cases(articles, cases, limit=limit)


def build_combined_reply(
    *,
    kb_result: dict | None,
    catalog_result: dict | None,
    contact_name: str = "",
) -> dict:
    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    parts: list[str] = []
    matched_articles = (kb_result or {}).get("matched_articles") or []
    matched_products = (catalog_result or {}).get("matched_products") or []
    if kb_result and kb_result.get("suggestion"):
        kb_body = kb_result["suggestion"]
        if kb_body.startswith(greeting.strip()):
            parts.append(kb_body)
        else:
            parts.append(kb_body.replace("مرحباً!", "").replace("مرحباً !", "").strip())
    if catalog_result and catalog_result.get("suggestion"):
        catalog_lines = catalog_result["suggestion"].split("\n\n")
        catalog_body = catalog_lines[-2] if len(catalog_lines) >= 2 else catalog_result["suggestion"]
        parts.append(catalog_body)
    body = "\n\n".join(part for part in parts if part)
    if not body:
        body = "شكراً لتواصلك — سأتابع معك قريباً."
    return {
        "suggestion": f"{greeting}{body}".strip(),
        "matched_articles": matched_articles,
        "matched_products": matched_products,
        "confidence": 0.9 if matched_articles and matched_products else 0.82,
        "source": "combined",
        "query": (kb_result or {}).get("query") or (catalog_result or {}).get("query") or "",
    }


async def _maybe_enhance_with_llm(
    db: AsyncSession,
    account_id: UUID,
    result: dict,
    *,
    query: str,
    contact_name: str,
) -> dict:
    settings = await get_agent_settings(db, account_id)
    account_key = _account_llm_api_key(settings)
    if not settings.llm_enabled or not llm_available(api_key=account_key):
        return result
    context = result.get("suggestion") or ""
    prompt = (
        f"Customer name: {contact_name or 'Customer'}\n"
        f"Customer message: {query}\n"
        f"Draft reply based on company knowledge:\n{context}\n\n"
        "Rewrite as a polished WhatsApp reply. Keep facts unchanged."
    )
    try:
        enhanced = await enhance_reply(
            user_prompt=prompt,
            system_prompt=settings.llm_system_prompt,
            tone=settings.tone,
            language=settings.language,
            api_key=account_key,
            api_base_url=settings.llm_api_base_url,
            model=settings.llm_model,
        )
    except Exception:
        return result
    if enhanced:
        result = {**result, "suggestion": enhanced, "source": f"{result.get('source', 'local')}+llm"}
    return result


async def _llm_only_reply(
    db: AsyncSession,
    account_id: UUID,
    *,
    query: str,
    contact_name: str,
) -> dict:
    """External model only — no local KB/catalog match."""
    settings = await get_agent_settings(db, account_id)
    account_key = _account_llm_api_key(settings)
    empty = {
        "suggestion": "",
        "source": "llm_only",
        "confidence": 0.0,
        "matched_articles": [],
        "matched_products": [],
        "engine": "external",
        "query": query,
    }
    if not settings.llm_enabled or not llm_available(api_key=account_key):
        return empty
    prompt = (
        f"Customer name: {contact_name or 'Customer'}\n"
        f"Customer message: {query}\n\n"
        "Write a short WhatsApp reply. Do not invent prices, stock, or product facts."
    )
    try:
        text = await enhance_reply(
            user_prompt=prompt,
            system_prompt=settings.llm_system_prompt,
            tone=settings.tone,
            language=settings.language,
            api_key=account_key,
            api_base_url=settings.llm_api_base_url,
            model=settings.llm_model,
        )
    except Exception:
        return empty
    if not text:
        return empty
    return {**empty, "suggestion": text, "confidence": 0.55}


async def suggest_smart_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    query: str,
    contact_name: str = "",
    mode: str | None = None,
    contact_context: dict | None = None,
    use_llm: bool | None = None,
    channel_id: UUID | None = None,
    dialogue_state: dict | None = None,
    membership=None,
) -> dict:
    from app.services.ai_ops import (
        build_escalation_reply,
        matches_escalation_keywords,
    )

    clarify_max_rounds = 2
    escalation_keywords: list[str] | None = None
    if channel_id is not None:
        from app.services.ai_ops import get_effective_agent_settings

        effective = await get_effective_agent_settings(
            db, account_id=account_id, channel_id=channel_id
        )
        normalized_mode = (mode or effective.get("default_mode") or "kb_first").lower()
        local_on = bool(effective.get("local_engine_enabled", True))
        llm_flag = bool(effective.get("llm_enabled", False))
        clarify_max_rounds = int(effective.get("clarify_max_rounds") or 2)
        keywords = effective.get("escalation_keywords")
        escalation_keywords = keywords if isinstance(keywords, list) else None
    else:
        settings = await get_agent_settings(db, account_id)
        normalized_mode = (mode or settings.default_mode or "kb_first").lower()
        local_on = bool(getattr(settings, "local_engine_enabled", True))
        llm_flag = bool(settings.llm_enabled)
    # Default: keep external model off unless explicitly enabled.
    should_llm = llm_flag if use_llm is None else bool(use_llm and llm_flag)

    if dialogue_state and dialogue_state.get("escalated"):
        return build_escalation_reply(
            contact_name=contact_name,
            reason=str(dialogue_state.get("escalate_reason") or "سبق التحويل لموظف"),
        )

    keyword_hit = matches_escalation_keywords(query, escalation_keywords)
    if keyword_hit:
        return build_escalation_reply(contact_name=contact_name, reason=keyword_hit)

    if not local_on:
        if should_llm:
            return await _llm_only_reply(
                db, account_id, query=query, contact_name=contact_name
            )
        return {
            "suggestion": "",
            "source": "engines_off",
            "confidence": 0.0,
            "matched_articles": [],
            "matched_products": [],
            "engine": "none",
            "query": query,
        }

    async def _kb_reply():
        # Strict channel isolation: Travel Zone never reads another number's KB.
        ranked = await search_knowledge_ranked(
            db,
            account_id,
            query,
            limit=5,
            channel_id=channel_id,
            strict_channel=True,
        )
        if not ranked:
            return None
        return build_knowledge_reply(
            [item.article for item in ranked],
            contact_name=contact_name,
            query=query,
            contact_context=contact_context,
            scored=ranked,
        )

    async def _catalog_reply():
        return await suggest_catalog_reply(
            db,
            account_id=account_id,
            query=query,
            contact_name=contact_name,
            channel_id=channel_id,
            dialogue_state=dialogue_state,
            membership=membership,
            include_unassigned=False,
            clarify_max_rounds=clarify_max_rounds,
        )

    if normalized_mode == "combined":
        kb_result = await _kb_reply()
        products = await search_catalog_products(
            db,
            account_id,
            query,
            channel_id=channel_id,
            membership=membership,
            include_unassigned=False,
        )
        catalog_result = (
            build_catalog_reply(
                products,
                contact_name=contact_name,
                query=query,
                dialogue_state=dialogue_state,
                clarify_max_rounds=clarify_max_rounds,
            )
            if products
            else None
        )
        if kb_result or catalog_result:
            result = build_combined_reply(
                kb_result=kb_result, catalog_result=catalog_result, contact_name=contact_name
            )
            if should_llm:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result

    if normalized_mode in {"kb_first", "knowledge_first", "kb"}:
        result = await _kb_reply()
        if result:
            if should_llm:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result
        result = await _catalog_reply()
        if should_llm:
            result = await _maybe_enhance_with_llm(db, account_id, result, query=query, contact_name=contact_name)
        return result

    if normalized_mode == "catalog_first":
        result = await _catalog_reply()
        if result.get("matched_products") or result.get("needs_clarification"):
            if should_llm:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result
        kb_result = await _kb_reply()
        if kb_result:
            if should_llm:
                kb_result = await _maybe_enhance_with_llm(
                    db, account_id, kb_result, query=query, contact_name=contact_name
                )
            return kb_result
        if should_llm:
            result = await _maybe_enhance_with_llm(db, account_id, result, query=query, contact_name=contact_name)
        return result

    if normalized_mode == "local":
        return suggest_reply(last_messages=[query] if query else [], contact_name=contact_name)

    result = await _kb_reply()
    if not result:
        products = await search_catalog_products(
            db,
            account_id,
            query,
            channel_id=channel_id,
            membership=membership,
            include_unassigned=False,
        )
        result = (
            build_catalog_reply(
                products,
                contact_name=contact_name,
                query=query,
                dialogue_state=dialogue_state,
                clarify_max_rounds=clarify_max_rounds,
            )
            if products
            else suggest_reply(last_messages=[query] if query else [], contact_name=contact_name)
        )
    if should_llm:
        result = await _maybe_enhance_with_llm(db, account_id, result, query=query, contact_name=contact_name)
    return result


async def export_knowledge_csv(db: AsyncSession, account_id: UUID) -> str:
    articles = await list_knowledge_articles(db, account_id, active_only=False)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["title", "body", "category", "keywords", "channel_id", "language", "sort_order", "is_active"]
    )
    for item in articles:
        writer.writerow([
            item.title,
            item.body,
            item.category,
            item.keywords or "",
            str(item.channel_id) if item.channel_id else "",
            item.language,
            item.sort_order,
            "true" if item.is_active else "false",
        ])
    return buffer.getvalue()


async def import_knowledge_csv(db: AsyncSession, account_id: UUID, content: str) -> dict:
    reader = csv.DictReader(io.StringIO(content))
    created = skipped = 0
    for row in reader:
        title = (row.get("title") or "").strip()
        body = (row.get("body") or "").strip()
        if not title or not body:
            skipped += 1
            continue
        channel_raw = (row.get("channel_id") or "").strip()
        channel_uuid = None
        if channel_raw:
            try:
                channel_uuid = UUID(channel_raw)
            except ValueError:
                skipped += 1
                continue
        item = KnowledgeArticle(
            account_id=account_id,
            channel_id=channel_uuid,
            title=title,
            body=body,
            category=(row.get("category") or "general").strip()[:80],
            keywords=(row.get("keywords") or "").strip() or None,
            language=(row.get("language") or "ar").strip()[:10],
            sort_order=int(row.get("sort_order") or 0),
            is_active=str(row.get("is_active") or "true").lower() != "false",
        )
        db.add(item)
        created += 1
    await db.commit()
    return {"created": created, "skipped": skipped}


async def generate_article_from_messages(
    db: AsyncSession,
    *,
    account_id: UUID,
    messages: list[str],
    title_hint: str = "",
) -> dict:
    inbound = [m.strip() for m in messages if m.strip()]
    if not inbound:
        raise ValueError("NO_MESSAGES")
    question = inbound[0][:200]
    answer_parts = inbound[1:4] if len(inbound) > 1 else inbound
    body = "\n".join(f"• {part[:400]}" for part in answer_parts)
    title = title_hint.strip() or question[:120] or "مقال من محادثة"
    return {
        "title": title,
        "body": body or question,
        "category": "faq",
        "keywords": question[:200],
        "language": "ar",
    }


async def conversation_copilot(
    db: AsyncSession,
    *,
    account_id: UUID,
    messages: list[str],
    contact_name: str = "",
) -> dict:
    summary = summarize_conversation(messages)
    intent = detect_intent(messages[-1] if messages else "")
    emotion = detect_emotion(messages[-1] if messages else "")
    suggestions = []
    for mode in ("kb_first", "catalog_first", "combined"):
        result = await suggest_smart_reply(
            db,
            account_id=account_id,
            query=messages[-1] if messages else "",
            contact_name=contact_name,
            mode=mode,
            use_llm=False,
        )
        if result.get("suggestion"):
            suggestions.append({"mode": mode, "text": result["suggestion"], "source": result.get("source")})
    return {
        "summary": summary.get("summary"),
        "intent": intent,
        "emotion": emotion,
        "suggestions": suggestions[:3],
        "llm_available": llm_available(),
    }
