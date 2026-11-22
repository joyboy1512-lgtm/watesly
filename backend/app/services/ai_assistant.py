"""AI assistant — local heuristics when no external API key is configured."""

from typing import Any

from app.core.config import settings
from app.services.internal_ai import (
    local_emotion,
    local_intent,
    local_suggest_reply,
    normalize_text,
)


def suggest_reply(*, last_messages: list[str], contact_name: str = "") -> dict[str, Any]:
    return local_suggest_reply(last_messages=last_messages, contact_name=contact_name)


def summarize_conversation(messages: list[str]) -> dict[str, Any]:
    if not messages:
        return {"summary": "لا توجد رسائل بعد.", "source": "local"}
    inbound = [m for m in messages if m]
    preview = " · ".join(inbound[-3:])
    intent = local_intent(inbound[-1] if inbound else "")
    return {
        "summary": f"آخر التفاعلات: {preview[:500]}",
        "message_count": len(messages),
        "source": "local",
        "intent": intent.get("intent"),
    }


def detect_intent(text: str) -> dict[str, Any]:
    return local_intent(text)


def detect_emotion(text: str) -> dict[str, Any]:
    return local_emotion(text)


def extract_data(text: str) -> dict[str, Any]:
    import re

    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    phone = re.search(r"\+?\d{8,15}", text)
    return {
        "email": email.group(0) if email else None,
        "phone": phone.group(0) if phone else None,
        "source": "local",
        "normalized": normalize_text(text)[:200],
    }


def categorize_conversation(messages: list[str]) -> dict[str, Any]:
    combined = normalize_text(" ".join(messages))
    intent = local_intent(combined)
    mapping = {
        "pricing": "billing",
        "cancellation": "support",
        "shipping": "shipping",
        "purchase": "sales",
        "question": "faq",
    }
    if any(w in combined for w in ("فاتوره", "فاتورة", "دفع", "payment", "invoice")):
        return {"category": "billing", "source": "local"}
    if any(w in combined for w in ("مشكله", "مشكلة", "عطل", "bug", "error")):
        return {"category": "support", "source": "local"}
    return {"category": mapping.get(intent.get("intent", ""), "general"), "source": "local"}


def agent_capabilities() -> dict[str, Any]:
    return {
        "name": "Watesly AI Agent",
        "version": settings.app_version,
        "capabilities": [
            "reply_suggestion",
            "summarization",
            "intent_detection",
            "emotion_detection",
            "data_extraction",
            "categorization",
            "synonym_matching",
            "feedback_learning",
            "quality_evaluation",
        ],
        "external_llm": bool(getattr(settings, "ai_api_key", None)),
        "note": "Internal engine uses Arabic normalization, synonyms, and feedback-weighted ranking. Optional LLM polishes replies.",
    }
