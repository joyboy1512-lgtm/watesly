"""Bilingual catalog matching + clarifying dialogue for ambiguous product queries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.catalog_query_parse import (
    ParsedProductQuery,
    SizeSpec,
    parse_product_query,
    product_attribute_roots,
    product_size_spec,
    product_type_roots,
)
from app.services.internal_ai import (
    expand_query_terms,
    local_intent,
    normalize_text,
    tokenize,
)

ENGINE = "catalog_bilingual_v2"


@dataclass
class ScoredProduct:
    product: Any
    score: float
    reasons: list[str]
    family_tokens: set[str]
    type_match: bool = False
    attribute_match: bool = False
    type_mismatch: bool = False
    size_match: bool | None = None
    size_available: SizeSpec | None = None
    alias_hit: bool = False


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


def score_catalog_product(
    product: Any,
    *,
    query_text: str,
    query_tokens: set[str] | None = None,
    parsed: ParsedProductQuery | None = None,
) -> ScoredProduct:
    parsed = parsed or parse_product_query(query_text)
    q_tokens = query_tokens if query_tokens is not None else parsed.tokens or expand_query_terms(query_text)
    query_n = normalize_text(query_text)
    blob = normalize_text(_product_text(product))
    name_n = normalize_text(getattr(product, "name", "") or "")
    product_tokens = tokenize(blob, expand_synonyms=True, drop_stopwords=False)
    name_tokens = tokenize(name_n, expand_synonyms=True, drop_stopwords=False)

    p_types = product_type_roots(product)
    p_attrs = product_attribute_roots(product)
    p_size = product_size_spec(product)

    score = 0.0
    reasons: list[str] = []

    # --- Alternate names (channel/product-specific phrases in keywords) ---
    alias_hit = False
    alias_phrases: list[str] = []
    alias_tokens = set()
    for part in str(getattr(product, "keywords", "") or "").split(","):
        part_n = normalize_text(part)
        if not part_n:
            continue
        alias_phrases.append(part_n)
        alias_tokens |= tokenize(part_n, expand_synonyms=True, drop_stopwords=False)
        # Phrase hit: full alternate name appears in the query (or vice versa for short queries)
        if len(part_n) >= 3 and (part_n in query_n or (len(query_n) >= 3 and query_n in part_n)):
            score += 0.42
            alias_hit = True
            reasons.append("alias_phrase")
    # Token hits from aliases, but ignore pure generic type-only overlap (شاور alone)
    distinctive_alias = alias_tokens - parsed.types
    if distinctive_alias & q_tokens:
        hit_n = len(distinctive_alias & q_tokens)
        score += min(0.38, 0.16 * hit_n)
        alias_hit = True
        reasons.append("alias_tokens")

    # --- Name overlap ---
    if name_n and (name_n in query_n or query_n in name_n):
        score += 0.5
        reasons.append("name_substring")
    elif name_tokens & q_tokens:
        hit = len(name_tokens & q_tokens) / max(len(q_tokens), 1)
        score += min(0.4, 0.16 + hit * 0.35)
        reasons.append("name_tokens")

    if product_tokens & q_tokens:
        overlap = len(q_tokens & product_tokens) / max(len(q_tokens), 1)
        score += overlap * 0.35
        if overlap >= 0.3:
            reasons.append("token_overlap")

    category = normalize_text(getattr(product, "category", "") or "")
    if category and category in query_n:
        score += 0.08
        reasons.append("category")

    # --- Structured type + attribute ---
    type_match = bool(parsed.types and (parsed.types & p_types))
    type_mismatch = bool(parsed.types and p_types and not (parsed.types & p_types))
    attribute_match = bool(parsed.attributes and (parsed.attributes & p_attrs))

    if type_match:
        score += 0.48
        reasons.append("type_match")
    if attribute_match:
        score += 0.36
        reasons.append("attribute_match")
    if type_match and attribute_match:
        score += 0.28
        reasons.append("type_attribute_pair")
    if type_mismatch:
        score -= 0.62
        reasons.append("type_mismatch")

    # Attribute-only query (أبي كوفي): boost scent family, leave room to clarify
    if parsed.attributes and not parsed.types and attribute_match:
        score += 0.12
        reasons.append("attribute_only")

    # Residual brand tokens (misk, etc.) against aliases/name
    residual_hits = parsed.residual_tokens & (name_tokens | alias_tokens | product_tokens)
    if residual_hits:
        score += min(0.3, 0.12 * len(residual_hits))
        reasons.append("residual_tokens")

    # --- Size ---
    size_match: bool | None = None
    if parsed.size is not None:
        if p_size and parsed.size.matches(p_size):
            size_match = True
            score += 0.22
            reasons.append("size_match")
        elif p_size:
            size_match = False
            score -= 0.08
            reasons.append("size_mismatch")
        else:
            size_match = False
            reasons.append("size_unknown")

    # Floor after heavy type mismatch so wrong family doesn't win on scent alone
    if type_mismatch and score > 0:
        score = min(score, 0.28)

    noise = {"سعر", "طلب", "شراء", "كم", "price", "cost", "buy", "order", "ابي", "ابغى"}
    family = (name_tokens | alias_tokens | p_types | p_attrs) - noise
    return ScoredProduct(
        product=product,
        score=round(max(score, 0.0), 4),
        reasons=reasons,
        family_tokens=family,
        type_match=type_match,
        attribute_match=attribute_match,
        type_mismatch=type_mismatch,
        size_match=size_match,
        size_available=p_size,
        alias_hit=alias_hit,
    )


def rank_catalog_products(
    products: list[Any],
    query_text: str,
    *,
    limit: int = 8,
    min_score: float = 0.2,
) -> list[ScoredProduct]:
    parsed = parse_product_query(query_text)
    q_tokens = parsed.tokens or expand_query_terms(query_text)
    ranked = [
        score_catalog_product(p, query_text=query_text, query_tokens=q_tokens, parsed=parsed)
        for p in products
    ]
    ranked.sort(
        key=lambda item: (
            item.score,
            1 if item.type_match and item.attribute_match else 0,
            1 if item.alias_hit else 0,
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
    parsed = parse_product_query(query)
    top = scored[0]

    # Decisive type + scent/attribute pair → answer without asking
    if top.type_match and top.attribute_match:
        runner = scored[1]
        if top.score >= runner.score + 0.35 or top.score >= runner.score * 1.25:
            return False

    # Decisive type match when attribute absent but runner is a type mismatch / weaker
    if top.type_match and not top.type_mismatch and top.score >= scored[1].score + 0.45:
        return False

    close = [item for item in scored if item.score >= max(0.22, top.score * 0.72)]
    if len(close) < 2:
        return False

    # Attribute-only (أبي كوفي) with multiple product types → always clarify
    if parsed.attributes and not parsed.types:
        distinct_types = {frozenset(product_type_roots(item.product)) for item in close}
        if len(distinct_types) >= 2:
            return True

    # Same Meta variant group → clarify among variants when query isn't exact
    group_ids = {
        str(getattr(item.product, "meta_item_group_id", "") or "")
        for item in close
        if getattr(item.product, "meta_item_group_id", None)
    }
    if len(group_ids) == 1 and next(iter(group_ids)):
        return top.score < 0.92

    shared = _shared_family(close)
    if shared and any(token in expand_query_terms(query) for token in shared):
        names = {normalize_text(getattr(item.product, "name", "") or "") for item in close}
        if len(names) >= 2 and not (top.type_match and top.attribute_match):
            return True

    # Two strong candidates without a decisive type+attribute winner
    if (
        top.score < 0.85
        and close[1].score >= top.score * 0.85
        and not (top.type_match and top.attribute_match)
    ):
        return True
    return False


def is_weak_match(scored: list[ScoredProduct], *, query: str) -> bool:
    if not scored:
        return True
    top = scored[0]
    parsed = parse_product_query(query)
    if top.score < 0.32:
        return True
    if top.type_mismatch:
        return True
    # Attribute-only with mediocre score and siblings → handled by clarify, not weak
    if parsed.types and not top.type_match and top.score < 0.55:
        return True
    return False


def _option_label(product: Any) -> str:
    name = (getattr(product, "name", "") or "").strip()
    size = (getattr(product, "variant_size", None) or "").strip()
    color = (getattr(product, "variant_color", None) or "").strip()
    extras = " / ".join(part for part in (size, color) if part)
    return f"{name} ({extras})" if extras else name


def _match_payload(item: ScoredProduct, *, index: int | None = None) -> dict:
    product = item.product
    payload = {
        "id": str(product.id),
        "name": product.name,
        "sku": getattr(product, "sku", None),
        "price": str(product.price) if product.price is not None else None,
        "currency": product.currency,
        "image_url": product.image_url,
        "description": (product.description or "")[:160] or None,
        "product_type": product.product_type,
        "category": product.category,
        "score": item.score,
        "reasons": item.reasons,
        "variant_size": getattr(product, "variant_size", None),
        "meta_retailer_id": getattr(product, "meta_retailer_id", None),
    }
    if index is not None:
        payload["clarify_option"] = index
    return payload


_ORDINAL_AR = {
    " الاول": 1,
    "الأول": 1,
    "اول": 1,
    "الأولى": 1,
    "الاول": 1,
    "الثاني": 2,
    "ثاني": 2,
    "الثانية": 2,
    "التالت": 3,
    "الثالث": 3,
    "ثالث": 3,
    "first": 1,
    "second": 2,
    "third": 3,
}


def resolve_clarify_followup(
    query: str,
    options: list[dict],
) -> dict | None:
    """Resolve replies like «السكراب» / «الثاني» / «2» against pending clarify options."""
    if not options:
        return None
    parsed = parse_product_query(query)
    q_n = normalize_text(query)
    tokens = parsed.tokens

    # Numeric / ordinal
    if q_n.strip().isdigit():
        idx = int(q_n.strip())
        for opt in options:
            if int(opt.get("clarify_option") or 0) == idx:
                return opt
    for word, idx in _ORDINAL_AR.items():
        if normalize_text(word) in tokens or normalize_text(word) == q_n:
            for opt in options:
                if int(opt.get("clarify_option") or 0) == idx:
                    return opt

    # Type / name reference against option labels
    best = None
    best_score = 0.0
    for opt in options:
        name_n = normalize_text(str(opt.get("name") or ""))
        name_tokens = tokenize(name_n, expand_synonyms=True, drop_stopwords=False)
        overlap = len(tokens & name_tokens)
        score = overlap * 0.4
        if parsed.types and parsed.types & name_tokens:
            score += 0.5
        if parsed.attributes and parsed.attributes & name_tokens:
            score += 0.35
        # Direct substring of option name keywords
        for token in tokens:
            if token and token in name_n:
                score += 0.25
        if score > best_score:
            best_score = score
            best = opt
    if best and best_score >= 0.45:
        return best
    return None


def build_clarifying_catalog_reply(
    scored: list[ScoredProduct],
    *,
    contact_name: str = "",
    query: str = "",
    format_price,
) -> dict:
    close = [item for item in scored if item.score >= max(0.22, scored[0].score * 0.58)][:6]
    # Prefer keeping type-diverse options when attribute-only
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
        payload = _match_payload(item, index=index)
        payload["price_label"] = price
        matched.append(payload)

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
        "engine": ENGINE,
        "expanded_terms": sorted(expand_query_terms(query))[:24],
        "parsed": _parsed_debug(query),
        "dialogue": {"clarify_options": matched},
    }


def build_weak_clarify_reply(*, contact_name: str = "", query: str = "") -> dict:
    name = contact_name or "عميلنا"
    return {
        "suggestion": (
            f"مرحباً {name}! لم أتأكد من الصنف المطلوب. "
            "وضّح النوع (مثل صابون / سكراب / شاور) والرائحة أو الاسم لأسعّر لك بدون تخمين."
        ),
        "matched_products": [],
        "confidence": 0.3,
        "source": "catalog_weak",
        "query": query,
        "needs_clarification": True,
        "engine": ENGINE,
        "expanded_terms": sorted(expand_query_terms(query))[:24],
        "parsed": _parsed_debug(query),
    }


def build_size_ask_reply(
    item: ScoredProduct,
    *,
    contact_name: str = "",
    query: str = "",
    format_price,
    requested: SizeSpec,
) -> dict:
    product = item.product
    available = item.size_available
    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    avail_label = (
        f"{available.value:g} {available.unit}"
        if available
        else (getattr(product, "variant_size", None) or "الحجم المتوفر لدينا")
    )
    req_label = f"{requested.value:g} {requested.unit}"
    price = format_price(product)
    suggestion = (
        f"{greeting}*{product.name}* متوفر لدينا بحجم {avail_label} بسعر {price}. "
        f"طلبت {req_label} — هل تريد المتوفر أم تبحث عن حجم آخر؟"
    )
    payload = _match_payload(item)
    payload["price_label"] = price
    return {
        "suggestion": suggestion,
        "matched_products": [payload],
        "confidence": 0.75,
        "source": "catalog_size_ask",
        "query": query,
        "needs_clarification": True,
        "engine": ENGINE,
        "size_requested": {"value": requested.value, "unit": requested.unit},
        "size_available": (
            {"value": available.value, "unit": available.unit} if available else None
        ),
        "dialogue": {"pending_product": payload, "awaiting": "size_confirm"},
        "parsed": _parsed_debug(query),
    }


def build_precise_catalog_reply(
    scored: list[ScoredProduct],
    *,
    contact_name: str = "",
    query: str = "",
    format_price,
    format_specs,
    dialogue_state: dict | None = None,
) -> dict:
    parsed = parse_product_query(query)
    dialogue_state = dialogue_state or {}

    # --- Follow-up against prior clarify options ---
    prior_options = dialogue_state.get("clarify_options") or []
    if prior_options:
        chosen = resolve_clarify_followup(query, prior_options)
        if chosen:
            # Re-rank only the chosen product for a precise reply; keep quantity in dialogue
            chosen_id = str(chosen.get("id") or "")
            filtered = [item for item in scored if str(item.product.id) == chosen_id]
            if not filtered:
                # Reconstruct minimal scored from options list context — caller should pass products
                pass
            else:
                scored = filtered
                # Fall through to precise single-product reply
                query = chosen.get("name") or query
                parsed = parse_product_query(query)
        elif parsed.quantity and dialogue_state.get("pending_product"):
            # «حبتين» after a product was selected
            pending = dialogue_state["pending_product"]
            pending_id = str(pending.get("id") or "")
            filtered = [item for item in scored if str(item.product.id) == pending_id]
            if filtered:
                scored = filtered
        elif not scored or is_weak_match(scored, query=query):
            # Short follow-up that didn't resolve — ask again
            if len(normalize_text(query).split()) <= 3 and prior_options:
                return build_clarifying_catalog_reply(
                    [
                        ScoredProduct(
                            product=_option_as_product(opt),
                            score=float(opt.get("score") or 0.5),
                            reasons=["prior_option"],
                            family_tokens=set(),
                        )
                        for opt in prior_options
                    ],
                    contact_name=contact_name,
                    query=query,
                    format_price=format_price,
                )

    if not scored:
        return build_weak_clarify_reply(contact_name=contact_name, query=query)

    if is_weak_match(scored, query=query) and not (
        dialogue_state.get("pending_product") or dialogue_state.get("clarify_options")
    ):
        # Still show weak options only if scores exist but unclear
        if len(scored) >= 2 and scored[0].score >= 0.22:
            return build_clarifying_catalog_reply(
                scored, contact_name=contact_name, query=query, format_price=format_price
            )
        return build_weak_clarify_reply(contact_name=contact_name, query=query)

    top = scored[0]
    # Size mismatch on an otherwise clear match → ask before substituting
    # (checked before multi-product clarify so a clear scent hit still asks about size)
    if (
        parsed.size
        and top.size_match is False
        and (top.type_match and top.attribute_match or top.alias_hit or top.score >= 0.9)
    ):
        return build_size_ask_reply(
            top,
            contact_name=contact_name,
            query=query,
            format_price=format_price,
            requested=parsed.size,
        )

    if should_clarify(scored, query=query):
        return build_clarifying_catalog_reply(
            scored, contact_name=contact_name, query=query, format_price=format_price
        )

    products = [item.product for item in scored[:5]]
    if not products:
        return build_weak_clarify_reply(contact_name=contact_name, query=query)

    lines = []
    matched = []
    qty = parsed.quantity
    for item in scored[:3]:
        product = item.product
        price = format_price(product)
        specs = format_specs(product.specs_json or {})
        line = f"• *{product.name}* — {price}"
        if qty and qty > 1 and product.price is not None:
            try:
                total = float(product.price) * qty
                line += f" × {qty} = {total:g} {product.currency}"
            except (TypeError, ValueError):
                pass
        if specs:
            line += f"\n  {specs}"
        if product.description:
            line += f"\n  {product.description[:120]}"
        lines.append(line)
        payload = _match_payload(item)
        payload["price_label"] = price
        if qty:
            payload["quantity"] = qty
        matched.append(payload)

    greeting = f"مرحباً {contact_name}! " if contact_name else "مرحباً! "
    intent = local_intent(query).get("intent")
    if intent == "pricing" and len(matched) == 1:
        head = "سعر هذا الصنف:"
    elif len(matched) == 1:
        head = "هذا ما يطابق طلبك:"
    else:
        head = "إليك أقرب المنتجات المطابقة:"
    suggestion = f"{greeting}{head}\n\n" + "\n\n".join(lines) + "\n\nهل تريد تفاصيل أكثر أو تأكيد الطلب؟"
    dialogue = {"pending_product": matched[0]} if len(matched) == 1 else {}
    if qty and dialogue.get("pending_product"):
        dialogue["quantity"] = qty
    return {
        "suggestion": suggestion,
        "matched_products": matched,
        "confidence": 0.9 if len(matched) == 1 else 0.8,
        "source": "catalog",
        "query": query,
        "needs_clarification": False,
        "engine": ENGINE,
        "expanded_terms": sorted(expand_query_terms(query))[:24],
        "parsed": _parsed_debug(query),
        "dialogue": dialogue,
    }


def _parsed_debug(query: str) -> dict:
    parsed = parse_product_query(query)
    return {
        "types": sorted(parsed.types),
        "attributes": sorted(parsed.attributes),
        "size": (
            {"value": parsed.size.value, "unit": parsed.size.unit} if parsed.size else None
        ),
        "quantity": parsed.quantity,
        "tokens": sorted(parsed.tokens)[:24],
    }


def _option_as_product(opt: dict) -> Any:
    from types import SimpleNamespace

    return SimpleNamespace(
        id=opt.get("id"),
        name=opt.get("name") or "",
        sku=opt.get("sku"),
        price=opt.get("price"),
        currency=opt.get("currency") or "KWD",
        image_url=opt.get("image_url"),
        description=opt.get("description"),
        product_type=opt.get("product_type") or "product",
        category=opt.get("category"),
        specs_json={},
        variant_size=opt.get("variant_size"),
        meta_retailer_id=opt.get("meta_retailer_id"),
        keywords="",
        variant_color=None,
        variant_attributes={},
        usage_count=0,
    )


def apply_dialogue_then_rank(
    products: list[Any],
    query: str,
    *,
    dialogue_state: dict | None = None,
    limit: int = 8,
) -> tuple[list[ScoredProduct], dict | None]:
    """If the message is a follow-up, narrow products before / after ranking."""
    dialogue_state = dialogue_state or {}
    prior = dialogue_state.get("clarify_options") or []
    pending = dialogue_state.get("pending_product")
    parsed = parse_product_query(query)

    if prior:
        chosen = resolve_clarify_followup(query, prior)
        if chosen:
            chosen_id = str(chosen.get("id"))
            narrowed = [p for p in products if str(p.id) == chosen_id]
            if narrowed:
                ranked = rank_catalog_products(narrowed, chosen.get("name") or query, limit=limit, min_score=0.0)
                # Preserve quantity from this message
                return ranked, {
                    "pending_product": chosen,
                    "quantity": parsed.quantity,
                    "resolved_from": "clarify",
                }

    if pending and parsed.quantity and not parsed.types and not parsed.attributes:
        pending_id = str(pending.get("id"))
        narrowed = [p for p in products if str(p.id) == pending_id]
        if narrowed:
            ranked = rank_catalog_products(
                narrowed, pending.get("name") or query, limit=1, min_score=0.0
            )
            return ranked, {
                "pending_product": pending,
                "quantity": parsed.quantity,
                "resolved_from": "quantity",
            }

    ranked = rank_catalog_products(products, query, limit=limit)
    return ranked, None
