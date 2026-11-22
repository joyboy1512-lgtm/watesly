"""Internal AI engine: Arabic normalization, synonyms, scoring, multi-article replies."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable

# Diacritics / tatweel stripping
_AR_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_TOKEN_SPLIT = re.compile(r"[\s,.;:!?،؟\-_/\\|()+\[\]{}\"'`~]+")
_LATIN_NORMALIZE = str.maketrans(
    {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
    }
)

# Canonical synonym groups (each group shares one root token)
SYNONYM_GROUPS: tuple[tuple[str, ...], ...] = (
    (
        "توصيل",
        "شحن",
        "توصيله",
        "التوصيل",
        "الشحن",
        "ديليفري",
        "يوصل",
        "يوصلني",
        "يوصلون",
        "delivery",
        "shipping",
        "مدة",
        "وقت",
        "ايام",
        "أيام",
    ),
    ("سعر", "اسعار", "أسعار", "تكلفة", "ثمن", "كم", "price", "cost", "pricing", "عرض", "عروض"),
    ("ارجاع", "إرجاع", "استبدال", "استرداد", "مرتجع", "رجع", "return", "refund", "exchange"),
    ("دفع", "سداد", "بطاقة", "كاش", "تحويل", "payment", "pay", "visa", "كي", "كي نت", "knet"),
    ("طلب", "اوردر", "أوردر", "order", "شراء", "ابي", "أبي", "أبغى", "ابغا", "buy"),
    ("مساعدة", "دعم", "خدمة", "help", "support", "مشكلة", "عطل"),
    ("فرع", "فروع", "موقع", "عنوان", "مكان", "location", "branch", "address"),
    ("دوام", "ساعات", "مواعيد", "مفتوح", "مغلق", "hours", "open", "closed"),
    ("ضمان", "كفال", "كفالة", "warranty"),
    ("توفر", "متوفر", "مخزون", "stock", "available", "availability"),
    ("حساب", "تسجيل", "دخول", "login", "account", "password", "كلمة"),
    ("شكرا", "شكراً", "مشكور", "thanks", "thank"),
    ("مرحبا", "السلام", "هلا", "اهلا", "أهلا", "hello", "hi"),
)

CATEGORY_INTENT_HINTS: dict[str, tuple[str, ...]] = {
    "shipping": ("توصيل", "شحن", "delivery", "shipping"),
    "pricing": ("سعر", "اسعار", "عرض", "price", "cost"),
    "returns": ("ارجاع", "استبدال", "استرداد", "return", "refund"),
    "faq": ("كيف", "ماذا", "متى", "هل", "how", "what", "when"),
    "general": (),
}

# Lightweight Arabic stopwords (kept short so meaningful tokens survive)
_STOPWORDS = {
    "من",
    "في",
    "على",
    "عن",
    "الى",
    "إلى",
    "ال",
    "و",
    "يا",
    "هذا",
    "هذه",
    "هل",
    "ما",
    "ماذا",
    "او",
    "أو",
    "the",
    "a",
    "an",
    "is",
    "to",
    "of",
    "for",
    "and",
    "or",
    "please",
    "لو",
    "سمحت",
    "منفضلك",
    "من فضلك",
}


def normalize_text(text: str) -> str:
    if not text:
        return ""
    value = unicodedata.normalize("NFKC", text).lower().translate(_LATIN_NORMALIZE)
    value = _AR_DIACRITICS.sub("", value)
    # Alef / ya / taa marbuta variants
    value = (
        value.replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ة", "ه")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
    )
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _canonical_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for group in SYNONYM_GROUPS:
        root = normalize_text(group[0])
        for word in group:
            mapping[normalize_text(word)] = root
    return mapping


_CANONICAL = _canonical_map()


def _strip_al_prefix(token: str) -> str:
    if token.startswith("ال") and len(token) > 3:
        return token[2:]
    return token


def tokenize(text: str, *, expand_synonyms: bool = True, drop_stopwords: bool = True) -> set[str]:
    normalized = normalize_text(text)
    raw = {part for part in _TOKEN_SPLIT.split(normalized) if len(part) >= 2}
    tokens: set[str] = set()
    for token in raw:
        variants = {token, _strip_al_prefix(token)}
        for item in variants:
            if drop_stopwords and item in _STOPWORDS:
                continue
            if len(item) < 2:
                continue
            tokens.add(item)
            if expand_synonyms:
                canon = _CANONICAL.get(item)
                if canon:
                    tokens.add(canon)
    return tokens


def expand_query_terms(query: str) -> set[str]:
    """Return query tokens plus synonym roots for ranking diagnostics."""
    return tokenize(query, expand_synonyms=True)


@dataclass
class ScoredArticle:
    article: Any
    score: float
    reasons: list[str]


def score_article(
    article: Any,
    *,
    query_text: str,
    query_tokens: set[str] | None = None,
) -> ScoredArticle:
    """Score one knowledge article for an inbound query."""
    q_tokens = query_tokens if query_tokens is not None else expand_query_terms(query_text)
    if not q_tokens and not (query_text or "").strip():
        return ScoredArticle(article=article, score=0.0, reasons=[])

    title_n = normalize_text(getattr(article, "title", "") or "")
    body_n = normalize_text(getattr(article, "body", "") or "")
    keywords_raw = getattr(article, "keywords", None) or ""
    category = normalize_text(getattr(article, "category", "") or "general")
    query_n = normalize_text(query_text)

    keyword_parts = [normalize_text(part) for part in str(keywords_raw).split(",") if part.strip()]
    keyword_tokens = set()
    for part in keyword_parts:
        keyword_tokens |= tokenize(part, expand_synonyms=True, drop_stopwords=False)

    title_tokens = tokenize(title_n, expand_synonyms=True, drop_stopwords=False)
    body_tokens = tokenize(body_n[:1200], expand_synonyms=True, drop_stopwords=True)
    article_tokens = title_tokens | body_tokens | keyword_tokens | tokenize(category, expand_synonyms=True)

    score = 0.0
    reasons: list[str] = []

    # Exact / substring title match
    if title_n and (title_n in query_n or query_n in title_n):
        score += 0.42
        reasons.append("title_substring")
    elif title_tokens and q_tokens and (title_tokens & q_tokens):
        overlap_title = len(title_tokens & q_tokens) / max(len(q_tokens), 1)
        boost = min(0.34, 0.18 + overlap_title * 0.25)
        score += boost
        reasons.append("title_tokens")

    # Keyword hits (high weight)
    if keyword_tokens and q_tokens:
        kw_hits = keyword_tokens & q_tokens
        if kw_hits:
            score += min(0.45, 0.18 * len(kw_hits))
            reasons.append(f"keywords:{len(kw_hits)}")
    for part in keyword_parts:
        if part and part in query_n:
            score += 0.12
            reasons.append("keyword_phrase")

    # Body / general token overlap
    if article_tokens and q_tokens:
        overlap = len(q_tokens & article_tokens) / max(len(q_tokens), 1)
        score += overlap * 0.55
        if overlap >= 0.34:
            reasons.append("token_overlap")

    # Category intent hint
    hints = CATEGORY_INTENT_HINTS.get(category, ())
    if hints and any(normalize_text(h) in q_tokens or normalize_text(h) in query_n for h in hints):
        score += 0.12
        reasons.append(f"category:{category}")

    # Learning signals (net quality outweighs raw usage)
    usage = int(getattr(article, "usage_count", 0) or 0)
    helpful = int(getattr(article, "helpful_count", 0) or 0)
    dismissed = int(getattr(article, "dismiss_count", 0) or 0)
    if helpful > 0:
        score += min(0.22, 0.05 * (helpful ** 0.5))
        reasons.append("helpful")
    if usage > 0 and dismissed == 0:
        score += min(0.1, 0.015 * (usage ** 0.5))
        reasons.append("usage")
    if dismissed > 0:
        score -= min(0.35, 0.08 * dismissed + 0.04 * (dismissed ** 0.5))
        reasons.append("dismiss_penalty")

    # Prefer manually prioritized articles slightly
    sort_order = int(getattr(article, "sort_order", 0) or 0)
    if sort_order > 0:
        score += min(0.06, sort_order / 500)

    return ScoredArticle(article=article, score=round(score, 4), reasons=reasons)


def rank_articles(
    articles: Iterable[Any],
    query_text: str,
    *,
    limit: int = 5,
    min_score: float = 0.18,
) -> list[ScoredArticle]:
    q_tokens = expand_query_terms(query_text)
    ranked = [score_article(article, query_text=query_text, query_tokens=q_tokens) for article in articles]
    ranked.sort(key=lambda item: (item.score, int(getattr(item.article, "usage_count", 0) or 0)), reverse=True)
    return [item for item in ranked if item.score >= min_score][:limit]


def complementary_articles(scored: list[ScoredArticle], *, max_extra: int = 2) -> list[ScoredArticle]:
    """Pick secondary articles that add new categories / high relative score."""
    if not scored:
        return []
    primary = scored[0]
    primary_cat = normalize_text(getattr(primary.article, "category", "") or "")
    extras: list[ScoredArticle] = []
    for item in scored[1:]:
        if len(extras) >= max_extra:
            break
        cat = normalize_text(getattr(item.article, "category", "") or "")
        # Keep if different category or still a strong match (>= 65% of primary)
        if cat != primary_cat or item.score >= primary.score * 0.65:
            if item.score >= 0.22:
                extras.append(item)
    return extras


def build_multi_article_body(scored: list[ScoredArticle], *, contact_context: dict | None = None) -> tuple[str, float]:
    """Compose a WhatsApp-ready body from one or more ranked articles."""
    if not scored:
        return "", 0.0
    from app.services.variables import render_template

    primary = scored[0].article
    body = (getattr(primary, "body", "") or "").strip()
    if contact_context:
        body = render_template(body, contact_context)

    extras = complementary_articles(scored)
    for item in extras:
        article = item.article
        snippet = (getattr(article, "body", "") or "").strip()
        if contact_context:
            snippet = render_template(snippet, contact_context)
        # Keep secondary snippets short
        short = snippet if len(snippet) <= 280 else snippet[:277].rstrip() + "…"
        title = getattr(article, "title", "") or "معلومة إضافية"
        body = f"{body}\n\n*{title}*\n{short}"

    confidence = min(0.97, 0.55 + scored[0].score * 0.35)
    if extras:
        confidence = min(0.98, confidence + 0.04 * len(extras))
    return body, round(confidence, 3)


def local_intent(text: str) -> dict[str, Any]:
    tokens = expand_query_terms(text)
    blob = normalize_text(text)
    # Domain intents first — “أبغى أعرف عن الديليفري” is shipping, not purchase.
    if tokens & {"ارجاع", "استرداد", "استبدال", "return", "refund"}:
        return {"intent": "cancellation", "confidence": 0.88}
    if tokens & {"سعر", "اسعار", "price", "cost"}:
        return {"intent": "pricing", "confidence": 0.84}
    if tokens & {"توصيل", "شحن", "delivery", "shipping", "يوصل"}:
        return {"intent": "shipping", "confidence": 0.84}
    if tokens & {"شراء", "order", "buy"} or any(w in blob for w in ("ابي اطلب", "أبغى اطلب", "ابغى اطلب")):
        return {"intent": "purchase", "confidence": 0.86}
    if tokens & {"طلب"} and not (tokens & {"توصيل", "شحن", "سعر"}):
        return {"intent": "purchase", "confidence": 0.7}
    if "?" in text or "؟" in text or tokens & {"كيف", "ماذا", "متى", "هل", "how", "what"}:
        return {"intent": "question", "confidence": 0.72}
    return {"intent": "general", "confidence": 0.52}


def local_emotion(text: str) -> dict[str, Any]:
    blob = normalize_text(text)
    if any(w in blob for w in ("غاضب", "سيء", "awful", "terrible", "angry", "زفت", "اسوأ")):
        return {"emotion": "frustrated", "confidence": 0.8}
    if any(w in blob for w in ("شكر", "ممتاز", "رائع", "thanks", "great", "مشكور")):
        return {"emotion": "positive", "confidence": 0.84}
    if any(w in blob for w in ("مستعجل", "ضروري", "عاجل", "urgent")):
        return {"emotion": "urgent", "confidence": 0.78}
    return {"emotion": "neutral", "confidence": 0.62}


def local_suggest_reply(*, last_messages: list[str], contact_name: str = "") -> dict[str, Any]:
    if not last_messages:
        return {"suggestion": "مرحباً! كيف يمكنني مساعدتك اليوم؟", "confidence": 0.5, "source": "local"}
    last = last_messages[-1]
    intent = local_intent(last)["intent"]
    name = contact_name or "عميلنا"
    if intent == "pricing":
        return {
            "suggestion": f"شكراً {name}. سأرسل لك تفاصيل الأسعار والعروض المتاحة الآن.",
            "confidence": 0.74,
            "source": "local",
            "intent": intent,
        }
    if intent == "shipping":
        return {
            "suggestion": f"شكراً {name}. بالنسبة للتوصيل، سأوضح لك المدة والمناطق المتاحة فوراً.",
            "confidence": 0.74,
            "source": "local",
            "intent": intent,
        }
    if intent == "cancellation":
        return {
            "suggestion": f"تمام {name}. أخبرني برقم الطلب وسأساعدك في الإرجاع/الاستبدال حسب السياسة.",
            "confidence": 0.76,
            "source": "local",
            "intent": intent,
        }
    if intent == "purchase":
        return {
            "suggestion": f"حياك {name}. تقدر تطلب مباشرة وأنا أجهز لك التفاصيل وخطوات الطلب.",
            "confidence": 0.73,
            "source": "local",
            "intent": intent,
        }
    if any(w in normalize_text(last) for w in ("مساعده", "مساعدة", "دعم", "help", "support")):
        return {
            "suggestion": f"بالتأكيد {name}، أنا هنا لمساعدتك. وضّح لي المشكلة باختصار.",
            "confidence": 0.75,
            "source": "local",
            "intent": "support",
        }
    return {
        "suggestion": f"شكراً {name} على رسالتك. سأتابع معك خلال لحظات.",
        "confidence": 0.6,
        "source": "local",
        "intent": intent,
    }


def evaluate_cases(
    articles: list[Any],
    cases: list[dict[str, Any]],
    *,
    limit: int = 5,
) -> dict[str, Any]:
    """Run offline quality cases against the internal ranker."""
    results = []
    hits = 0
    for index, case in enumerate(cases):
        query = str(case.get("query") or "").strip()
        expected_id = str(case.get("expected_article_id") or "").strip() or None
        expected_title = normalize_text(str(case.get("expected_title") or ""))
        ranked = rank_articles(articles, query, limit=limit)
        top = ranked[0] if ranked else None
        top_id = str(getattr(top.article, "id", "")) if top else None
        top_title = getattr(top.article, "title", None) if top else None
        matched = False
        if top and expected_id and top_id == expected_id:
            matched = True
        elif top and expected_title and expected_title in normalize_text(top_title or ""):
            matched = True
        elif top and not expected_id and not expected_title and top.score >= 0.25:
            matched = True
        if matched:
            hits += 1
        results.append(
            {
                "index": index,
                "query": query,
                "matched": matched,
                "top_article_id": top_id,
                "top_title": top_title,
                "top_score": top.score if top else 0.0,
                "reasons": top.reasons if top else [],
                "candidates": [
                    {
                        "id": str(getattr(item.article, "id", "")),
                        "title": getattr(item.article, "title", ""),
                        "score": item.score,
                        "category": getattr(item.article, "category", ""),
                    }
                    for item in ranked[:3]
                ],
            }
        )
    total = len(cases)
    return {
        "total": total,
        "hits": hits,
        "hit_rate": round(hits / total, 3) if total else 0.0,
        "results": results,
    }
