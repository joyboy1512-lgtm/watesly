"""Knowledge base search, smart reply, import/export, and agent settings."""

from __future__ import annotations

import csv
import io
import re
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_agent_settings import AiAgentSettings
from app.models.knowledge_article import KnowledgeArticle
from app.services.ai_assistant import (
    categorize_conversation,
    detect_emotion,
    detect_intent,
    suggest_reply,
    summarize_conversation,
)
from app.services.catalog import build_catalog_reply, search_catalog_products, suggest_catalog_reply
from app.services.llm_client import enhance_reply, llm_available
from app.services.variables import render_template

_TOKEN_SPLIT = re.compile(r"[\s,.;:!?،؟]+")


def _tokens(text: str) -> set[str]:
    return {part.lower() for part in _TOKEN_SPLIT.split(text.lower()) if len(part) >= 2}


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
    for key, value in fields.items():
        if hasattr(item, key):
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def list_knowledge_articles(
    db: AsyncSession,
    account_id: UUID,
    *,
    active_only: bool = True,
    category: str | None = None,
) -> list[KnowledgeArticle]:
    query = select(KnowledgeArticle).where(KnowledgeArticle.account_id == account_id)
    if active_only:
        query = query.where(KnowledgeArticle.is_active.is_(True))
    if category:
        query = query.where(KnowledgeArticle.category == category)
    query = query.order_by(KnowledgeArticle.sort_order.asc(), KnowledgeArticle.title.asc())
    return list((await db.execute(query)).scalars().all())


async def list_knowledge_categories(db: AsyncSession, account_id: UUID) -> list[str]:
    rows = (
        await db.execute(
            select(KnowledgeArticle.category)
            .where(
                KnowledgeArticle.account_id == account_id,
                KnowledgeArticle.is_active.is_(True),
            )
            .distinct()
            .order_by(KnowledgeArticle.category.asc())
        )
    ).all()
    return [row[0] for row in rows if row[0]]


def _score_article(article: KnowledgeArticle, query_tokens: set[str], query_text: str) -> float:
    if not query_tokens:
        return 0.0
    haystack = f"{article.title} {article.body} {article.keywords or ''} {article.category}".lower()
    article_tokens = _tokens(haystack)
    overlap = len(query_tokens & article_tokens)
    score = overlap / max(len(query_tokens), 1)
    lower = query_text.lower()
    if article.title.lower() in lower or lower in article.title.lower():
        score += 0.35
    if article.keywords:
        for part in article.keywords.split(","):
            part = part.strip().lower()
            if part and part in lower:
                score += 0.2
    return score


async def search_knowledge_articles(
    db: AsyncSession,
    account_id: UUID,
    query_text: str,
    *,
    limit: int = 5,
) -> list[KnowledgeArticle]:
    term = f"%{query_text.strip()}%"
    if not query_text.strip():
        return await list_knowledge_articles(db, account_id)

    ilike_result = list(
        (
            await db.execute(
                select(KnowledgeArticle)
                .where(
                    KnowledgeArticle.account_id == account_id,
                    KnowledgeArticle.is_active.is_(True),
                    or_(
                        KnowledgeArticle.title.ilike(term),
                        KnowledgeArticle.body.ilike(term),
                        KnowledgeArticle.keywords.ilike(term),
                    ),
                )
                .order_by(KnowledgeArticle.sort_order.asc())
                .limit(limit)
            )
        ).scalars().all()
    )
    if ilike_result:
        return ilike_result

    all_active = await list_knowledge_articles(db, account_id)
    query_tokens = _tokens(query_text)
    ranked = sorted(
        (( _score_article(article, query_tokens, query_text), article) for article in all_active),
        key=lambda item: item[0],
        reverse=True,
    )
    return [article for score, article in ranked if score > 0.15][:limit]


async def increment_article_usage(db: AsyncSession, article: KnowledgeArticle) -> None:
    article.usage_count = (article.usage_count or 0) + 1
    await db.commit()


def build_knowledge_reply(
    articles: list[KnowledgeArticle],
    *,
    contact_name: str = "",
    query: str = "",
    contact_context: dict | None = None,
) -> dict:
    if not articles:
        return {}
    article = articles[0]
    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    body = article.body.strip()
    if contact_context:
        body = render_template(body, contact_context)
    if len(articles) > 1:
        extras = "\n".join(f"• {item.title}" for item in articles[1:3])
        body = f"{body}\n\nمواضيع ذات صلة:\n{extras}"
    return {
        "suggestion": f"{greeting}{body}",
        "matched_articles": [
            {"id": str(a.id), "title": a.title, "category": a.category, "body": a.body[:200]}
            for a in articles[:3]
        ],
        "confidence": 0.88,
        "source": "knowledge_base",
        "query": query,
    }


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
    if not settings.llm_enabled or not llm_available():
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
        )
    except Exception:
        return result
    if enhanced:
        result = {**result, "suggestion": enhanced, "source": f"{result.get('source', 'local')}+llm"}
    return result


async def suggest_smart_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    query: str,
    contact_name: str = "",
    mode: str | None = None,
    contact_context: dict | None = None,
    use_llm: bool | None = None,
) -> dict:
    settings = await get_agent_settings(db, account_id)
    normalized_mode = (mode or settings.default_mode or "kb_first").lower()
    should_llm = settings.llm_enabled if use_llm is None else use_llm

    if normalized_mode == "combined":
        articles = await search_knowledge_articles(db, account_id, query)
        products = await search_catalog_products(db, account_id, query)
        kb_result = build_knowledge_reply(
            articles, contact_name=contact_name, query=query, contact_context=contact_context
        ) if articles else None
        catalog_result = build_catalog_reply(products, contact_name=contact_name, query=query) if products else None
        if kb_result or catalog_result:
            result = build_combined_reply(
                kb_result=kb_result, catalog_result=catalog_result, contact_name=contact_name
            )
            if should_llm and settings.llm_enabled:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result

    if normalized_mode in {"kb_first", "knowledge_first", "kb"}:
        articles = await search_knowledge_articles(db, account_id, query)
        if articles:
            result = build_knowledge_reply(
                articles, contact_name=contact_name, query=query, contact_context=contact_context
            )
            if should_llm and settings.llm_enabled:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result
        result = await suggest_catalog_reply(db, account_id=account_id, query=query, contact_name=contact_name)
        if should_llm and settings.llm_enabled:
            result = await _maybe_enhance_with_llm(db, account_id, result, query=query, contact_name=contact_name)
        return result

    if normalized_mode == "catalog_first":
        result = await suggest_catalog_reply(db, account_id=account_id, query=query, contact_name=contact_name)
        if result.get("matched_products"):
            if should_llm and settings.llm_enabled:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result
        articles = await search_knowledge_articles(db, account_id, query)
        if articles:
            result = build_knowledge_reply(
                articles, contact_name=contact_name, query=query, contact_context=contact_context
            )
            if should_llm and settings.llm_enabled:
                result = await _maybe_enhance_with_llm(
                    db, account_id, result, query=query, contact_name=contact_name
                )
            return result
        if should_llm and settings.llm_enabled:
            result = await _maybe_enhance_with_llm(db, account_id, result, query=query, contact_name=contact_name)
        return result

    if normalized_mode == "local":
        return suggest_reply(last_messages=[query] if query else [], contact_name=contact_name)

    articles = await search_knowledge_articles(db, account_id, query)
    if articles:
        result = build_knowledge_reply(
            articles, contact_name=contact_name, query=query, contact_context=contact_context
        )
    else:
        products = await search_catalog_products(db, account_id, query)
        result = (
            build_catalog_reply(products, contact_name=contact_name, query=query)
            if products
            else suggest_reply(last_messages=[query] if query else [], contact_name=contact_name)
        )
    if should_llm and settings.llm_enabled:
        result = await _maybe_enhance_with_llm(db, account_id, result, query=query, contact_name=contact_name)
    return result


async def export_knowledge_csv(db: AsyncSession, account_id: UUID) -> str:
    articles = await list_knowledge_articles(db, account_id, active_only=False)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["title", "body", "category", "keywords", "language", "sort_order", "is_active"])
    for item in articles:
        writer.writerow([
            item.title,
            item.body,
            item.category,
            item.keywords or "",
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
        item = KnowledgeArticle(
            account_id=account_id,
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
