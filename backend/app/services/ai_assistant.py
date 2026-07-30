"""AI assistant — local heuristics when no external API key is configured."""

from typing import Any

from app.core.config import settings


def suggest_reply(*, last_messages: list[str], contact_name: str = "") -> dict[str, Any]:
    if not last_messages:
        return {"suggestion": "مرحباً! كيف يمكنني مساعدتك اليوم؟", "confidence": 0.5, "source": "local"}
    last = last_messages[-1].lower()
    if any(w in last for w in ("price", "cost", "سعر", "كم")):
        return {"suggestion": "شكراً لتواصلك. سأرسل لك تفاصيل الأسعار فوراً.", "confidence": 0.7, "source": "local"}
    if any(w in last for w in ("help", "support", "مساعدة")):
        return {"suggestion": "بالتأكيد، أنا هنا لمساعدتك. ما المشكلة التي تواجهها؟", "confidence": 0.75, "source": "local"}
    name = contact_name or "عميلنا"
    return {
        "suggestion": f"شكراً {name} على رسالتك. سأتابع معك خلال لحظات.",
        "confidence": 0.6,
        "source": "local",
    }


def summarize_conversation(messages: list[str]) -> dict[str, Any]:
    if not messages:
        return {"summary": "لا توجد رسائل بعد.", "source": "local"}
    inbound = [m for m in messages if m]
    preview = " · ".join(inbound[-3:])
    return {"summary": f"آخر التفاعلات: {preview[:500]}", "message_count": len(messages), "source": "local"}


def detect_intent(text: str) -> dict[str, Any]:
    lower = text.lower()
    if any(w in lower for w in ("buy", "order", "شراء", "طلب")):
        return {"intent": "purchase", "confidence": 0.8}
    if any(w in lower for w in ("cancel", "refund", "إلغاء", "استرداد")):
        return {"intent": "cancellation", "confidence": 0.85}
    if any(w in lower for w in ("?", "how", "what", "كيف", "ماذا")):
        return {"intent": "question", "confidence": 0.7}
    return {"intent": "general", "confidence": 0.5}


def detect_emotion(text: str) -> dict[str, Any]:
    lower = text.lower()
    if any(w in lower for w in ("angry", "bad", "terrible", "غاضب", "سيء")):
        return {"emotion": "frustrated", "confidence": 0.75}
    if any(w in lower for w in ("thank", "great", "شكر", "ممتاز")):
        return {"emotion": "positive", "confidence": 0.8}
    return {"emotion": "neutral", "confidence": 0.6}


def extract_data(text: str) -> dict[str, Any]:
    import re

    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    phone = re.search(r"\+?\d{8,15}", text)
    return {
        "email": email.group(0) if email else None,
        "phone": phone.group(0) if phone else None,
        "source": "local",
    }


def categorize_conversation(messages: list[str]) -> dict[str, Any]:
    combined = " ".join(messages).lower()
    if any(w in combined for w in ("invoice", "payment", "فاتورة", "دفع")):
        return {"category": "billing", "source": "local"}
    if any(w in combined for w in ("bug", "error", "مشكلة", "عطل")):
        return {"category": "support", "source": "local"}
    return {"category": "general", "source": "local"}


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
        ],
        "external_llm": bool(getattr(settings, "ai_api_key", None)),
        "note": "Connect AI_API_KEY for enhanced responses (Phase 9 — external link deferred).",
    }
