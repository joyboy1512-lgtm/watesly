"""Bilingual catalog matching + clarifying dialogue for ambiguous product queries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.internal_ai import (
    expand_query_terms,
    local_intent,
    normalize_text,
    tokenize,
)

@dataclass
class ScoredProduct:
    product: Any
    score: float
    reasons: list[str]
    family_tokens: set[str]


def _product_text(product: Any) -> str:
    parts = [
        getattr(product, "name", "") or "",
        getattr(product, "description", "") or "",
        getattr(product, "keywords", "") or "",
        getattr(product, "category", "") or "",
        getattr(product, "sku", "") or "",
        getattr(product, "variant_size", "") or "",
        getattr(product, "variant_color", "") or "",
    ]
    attrs = getattr(product, "variant_attributes", None) or {}
    if isinstance(attrs, dict):
        parts.extend(f"{k} {v}" for k, v in attrs.items())
    return " ".join(str(p) for p in parts if p)


def score_catalog_product(product: Any, *, query_text: str, query_tokens: set[str] | None = None) -> ScoredProduct:
    q_tokens = query_tokens if query_tokens is not None else expand_query_terms(query_text)
    query_n = normalize_text(query_text)
    blob = normalize_text(_product_text(product))
    name_n = normalize_text(getattr(product, "name", "") or "")
    product_tokens = tokenize(blob, expand_synonyms=True, drop_stopwords=False)
    name_tokens = tokenize(name_n, expand_synonyms=True, drop_stopwords=False)

    score = 0.0
    reasons: list[str] = []

    if name_n and (name_n in query_n or query_n in name_n):
        score += 0.5
        reasons.append("name_substring")
    elif name_tokens & q_tokens:
        hit = len(name_tokens & q_tokens) / max(len(q_tokens), 1)
        score += min(0.4, 0.16 + hit * 0.35)
        reasons.append("name_tokens")

    keywords = getattr(product, "keywords", None) or ""
    kw_tokens = set()
    for part in str(keywords).split(","):
        part_n = normalize_text(part)
        if not part_n:
            continue
        kw_tokens |= tokenize(part_n, expand_synonyms=True, drop_stopwords=False)
        if part_n in query_n:
            score += 0.12
            reasons.append("keyword_phrase")
    if kw_tokens & q_tokens:
        score += min(0.35, 0.14 * len(kw_tokens & q_tokens))
        reasons.append("keywords")

    if product_tokens & q_tokens:
        overlap = len(q_tokens & product_tokens) / max(len(q_tokens), 1)
        score += overlap * 0.5
        if overlap >= 0.3:
            reasons.append("token_overlap")

    category = normalize_text(getattr(product, "category", "") or "")
    if category and category in query_n:
        score += 0.1
        reasons.append("category")

    # Family tokens = product identity terms excluding intent noise (price/buy)
    noise = {"سعر", "طلب", "شراء", "كم", "price", "cost", "buy", "order"}
    family = (name_tokens | kw_tokens) - noise
    return ScoredProduct(product=product, score=round(score, 4), reasons=reasons, family_tokens=family)


def rank_catalog_products(
    products: list[Any],
    query_text: str,
    *,
    limit: int = 8,
    min_score: float = 0.2,
) -> list[ScoredProduct]:
    q_tokens = expand_query_terms(query_text)
    ranked = [score_catalog_product(p, query_text=query_text, query_tokens=q_tokens) for p in products]
    ranked.sort(
        key=lambda item: (
            item.score,
            int(getattr(item.product, "usage_count", 0) or 0),
        ),
        reverse=True,
    )
    return [item for item in ranked if item.score >= min_score][:limit]


def _shared_family(scored: list[ScoredProduct]) -> set[str]:
    if not scored:
        return set()
    shared = set(scored[0].family_tokens)
    for item in scored[1:]:
        shared &= item.family_tokens
    return shared


def should_clarify(scored: list[ScoredProduct], *, query: str) -> bool:
    """True when several close matches exist and the query is still broad."""
    if len(scored) < 2:
        return False
    top = scored[0]
    close = [item for item in scored if item.score >= max(0.22, top.score * 0.58)]
    if len(close) < 2:
        return False

    # Same Meta variant group → always clarify among variants when query isn't exact
    group_ids = {
        str(getattr(item.product, "meta_item_group_id", "") or "")
        for item in close
        if getattr(item.product, "meta_item_group_id", None)
    }
    if len(group_ids) == 1 and next(iter(group_ids)):
        return top.score < 0.92

    shared = _shared_family(close)
    # Broad family term in query (صابون) with multiple subtypes
    if shared and any(token in expand_query_terms(query) for token in shared):
        # Distinct product names → ask which one
        names = {normalize_text(getattr(item.product, "name", "") or "") for item in close}
        if len(names) >= 2:
            return True

    # Close scores without a decisive winner
    if top.score < 0.78 and close[1].score >= top.score * 0.75:
        return True
    return False


def _option_label(product: Any) -> str:
    name = (getattr(product, "name", "") or "").strip()
    size = (getattr(product, "variant_size", None) or "").strip()
    color = (getattr(product, "variant_color", None) or "").strip()
    extras = " / ".join(part for part in (size, color) if part)
    return f"{name} ({extras})" if extras else name


def build_clarifying_catalog_reply(
    scored: list[ScoredProduct],
    *,
    contact_name: str = "",
    query: str = "",
    format_price,
) -> dict:
    close = [item for item in scored if item.score >= max(0.22, scored[0].score * 0.58)][:6]
    intent = local_intent(query).get("intent")
    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    if intent == "pricing":
        intro = "لدينا عدة أنواع تناسب سؤالك عن السعر. أي واحد تقصد؟"
    else:
        intro = "لدينا عدة أنواع لهذا الصنف. أي واحد تقصد حتى أعطيك المعلومة الصحيحة؟"

    lines = []
    matched = []
    for index, item in enumerate(close, start=1):
        product = item.product
        price = format_price(product)
        label = _option_label(product)
        lines.append(f"{index}) {label} — {price}")
        matched.append(
            {
                "id": str(product.id),
                "name": product.name,
                "price": str(product.price) if product.price is not None else None,
                "currency": product.currency,
                "price_label": price,
                "image_url": product.image_url,
                "description": (product.description or "")[:160] or None,
                "product_type": product.product_type,
                "category": product.category,
                "score": item.score,
                "clarify_option": index,
            }
        )

    body = "\n".join(lines)
    suggestion = (
        f"{greeting}{intro}\n\n{body}\n\n"
        "اكتب رقم الخيار أو اسم النوع بالضبط — بدون تخمين من طرفي."
    )
    return {
        "suggestion": suggestion,
        "matched_products": matched,
        "confidence": 0.7,
        "source": "catalog_clarify",
        "query": query,
        "needs_clarification": True,
        "clarify_options": matched,
        "engine": "catalog_bilingual_v1",
        "expanded_terms": sorted(expand_query_terms(query))[:24],
    }


def build_precise_catalog_reply(
    scored: list[ScoredProduct],
    *,
    contact_name: str = "",
    query: str = "",
    format_price,
    format_specs,
) -> dict:
    products = [item.product for item in scored[:5]]
    if not products:
        name = contact_name or "عميلنا"
        return {
            "suggestion": f"مرحباً {name}! لم أجد منتجًا مطابقًا بوضوح. وضّح الاسم أو النوع لأدقق لك.",
            "matched_products": [],
            "confidence": 0.35,
            "source": "catalog",
            "needs_clarification": False,
            "engine": "catalog_bilingual_v1",
        }

    if should_clarify(scored, query=query):
        return build_clarifying_catalog_reply(
            scored, contact_name=contact_name, query=query, format_price=format_price
        )

    lines = []
    matched = []
    for item in scored[:3]:
        product = item.product
        price = format_price(product)
        specs = format_specs(product.specs_json or {})
        line = f"• *{product.name}* — {price}"
        if specs:
            line += f"\n  {specs}"
        if product.description:
            line += f"\n  {product.description[:120]}"
        lines.append(line)
        matched.append(
            {
                "id": str(product.id),
                "name": product.name,
                "price": str(product.price) if product.price is not None else None,
                "currency": product.currency,
                "price_label": price,
                "image_url": product.image_url,
                "description": (product.description or "")[:160] or None,
                "specs_preview": specs or None,
                "product_type": product.product_type,
                "meta_retailer_id": product.meta_retailer_id,
                "category": product.category,
                "score": item.score,
                "reasons": item.reasons,
            }
        )

    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    intent = local_intent(query).get("intent")
    if intent == "pricing" and len(matched) == 1:
        head = "سعر هذا الصنف:"
    elif len(matched) == 1:
        head = "هذا ما يطابق طلبك:"
    else:
        head = "إليك أقرب المنتجات المطابقة:"
    suggestion = f"{greeting}{head}\n\n" + "\n\n".join(lines) + "\n\nهل تريد تفاصيل أكثر أو تأكيد الطلب؟"
    return {
        "suggestion": suggestion,
        "matched_products": matched,
        "confidence": 0.9 if len(matched) == 1 else 0.8,
        "source": "catalog",
        "query": query,
        "needs_clarification": False,
        "engine": "catalog_bilingual_v1",
        "expanded_terms": sorted(expand_query_terms(query))[:24],
    }
