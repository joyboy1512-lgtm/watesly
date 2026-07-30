"""Infer contact gender from display name using a local dictionary and optional LLM."""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

from app.core.config import settings
from app.services.llm_client import llm_available

Gender = Literal["male", "female", "unknown"]

_AR_DIACRITICS = re.compile(r"[\u064B-\u065F\u0670]")
_NON_LETTER = re.compile(r"[^\w\u0600-\u06FF]+", re.UNICODE)
_TITLE_PREFIXES = (
    "mr", "mrs", "ms", "miss", "dr", "prof",
    "السيد", "السيدة", "الاستاذ", "الأستاذ", "أستاذ", "استاذ",
    "أ", "ا",
)

MALE_NAMES: frozenset[str] = frozenset({
    "mohammed", "mohammad", "muhammad", "mohamed", "ahmed", "ahmad", "ali", "omar", "hassan",
    "hussein", "hussain", "khalid", "saud", "faisal", "fahad", "fahd", "turki", "bandar",
    "nasser", "sultan", "majed", "yousef", "yusuf", "youssef", "abdullah", "abdulrahman",
    "abdulaziz", "abdul", "saleh", "salman", "khaled", "tariq", "zaid", "hamad", "hamza",
    "ibrahim", "ismail", "yahya", "yasin", "anas", "bilal", "mustafa", "osama", "samir",
    "karim", "rami", "tamer", "waleed", "walid", "zain", "zayn", "john", "james", "michael",
    "david", "robert", "william", "richard", "joseph", "thomas", "charles", "daniel",
    "matthew", "mark", "paul", "steven", "andrew", "kevin", "brian", "george", "edward",
    "محمد", "احمد", "أحمد", "علي", "عمر", "حسن", "حسين", "خالد", "سعود", "فيصل", "فهد",
    "تركي", "بندر", "ناصر", "سلطان", "ماجد", "يوسف", "عبدالله", "عبدالرحمن", "عبدالعزيز",
    "صالح", "سلمان", "طارق", "زيد", "حمد", "حمزة", "إبراهيم", "ابراهيم", "اسماعيل",
    "إسماعيل", "يحيى", "ياسين", "أنس", "انس", "بلال", "مصطفى", "اسامة", "أسامة", "سمير",
    "كريم", "رامي", "تامر", "وليد", "زين", "راشد", "سالم", "عادل", "جمال", "فارس",
})

FEMALE_NAMES: frozenset[str] = frozenset({
    "fatima", "fatimah", "maryam", "mariam", "sara", "sarah", "noura", "nora", "layla",
    "leila", "laila", "reem", "rana", "dina", "diana", "hala", "huda", "lama", "lina",
    "maha", "mona", "nada", "nadia", "nour", "noor", "rasha", "salma", "samira", "yasmin",
    "yasmine", "zahra", "amira", "amani", "bushra", "dalal", "farah", "ghada",
    "haneen", "heba", "iman", "jumana", "khadija", "latifa", "manal", "nawal",
    "rania", "shaima", "wafa", "zainab", "mary", "jennifer", "linda", "patricia", "elizabeth",
    "barbara", "susan", "jessica", "karen", "nancy", "lisa", "betty", "helen", "sandra",
    "donna", "carol", "michelle", "emily", "emma", "olivia", "sophia", "isabella", "ava",
    "فاطمة", "فاطمه", "مريم", "سارة", "ساره", "نورة", "نوره", "ليلى", "ريم", "رana",
    "دينا", "هيفاء", "هدى", "هدي", "لمى", "لما", "لينا", "مها", "منى", "مني",
    "ندى", "نادية", "نور", "رشا", "سلمى", "سميرة", "ياسمين",
    "زهراء", "زهره", "أميرة", "اميرة", "أماني", "اماني", "بشرى", "دلال",
    "فرح", "غada", "حنين", "هبة", "هبه", "إيمان", "ايمان", "جمانة",
    "خديجة", "خديجه", "لatifah", "latifah", "منال", "شيماء", "وفاء", "زينب",
})


def _normalize_token(token: str) -> str:
    text = unicodedata.normalize("NFKC", token.strip().lower())
    text = _AR_DIACRITICS.sub("", text)
    text = _NON_LETTER.sub("", text)
    if text.startswith("ال") and len(text) > 2:
        text = text[2:]
    return text


def _extract_first_name(name: str | None) -> str | None:
    if not name or not name.strip():
        return None
    parts = [part.strip() for part in re.split(r"\s+", name.strip()) if part.strip()]
    for part in parts:
        normalized = _normalize_token(part)
        if not normalized:
            continue
        if normalized in _TITLE_PREFIXES:
            continue
        if normalized in {"abu", "abou", "bin", "bint", "ibn", "بن", "بint", "ابن", "بint"}:
            continue
        return normalized
    return None


def infer_gender_from_name(name: str | None) -> Gender:
    """Dictionary-only inference (sync)."""
    first = _extract_first_name(name)
    if not first:
        return "unknown"
    if first in MALE_NAMES:
        return "male"
    if first in FEMALE_NAMES:
        return "female"
    return "unknown"


async def infer_gender_with_llm_fallback(name: str | None) -> Gender:
    result = infer_gender_from_name(name)
    if result != "unknown" or not llm_available() or not name or not name.strip():
        return result

    try:
        import httpx

        base_url = settings.ai_api_base_url.rstrip("/")
        model = settings.ai_model
        prompt = (
            "Given a person's name, respond with exactly one word: male, female, or unknown. "
            f"Name: {name.strip()}"
        )
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": 8,
        }
        headers = {
            "Authorization": f"Bearer {settings.ai_api_key.get_secret_value()}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        if response.is_error:
            return result
        content = (
            (response.json().get("choices") or [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        answer = str(content).strip().lower()
        if answer in {"male", "female", "unknown"}:
            return answer  # type: ignore[return-value]
    except Exception:
        return result
    return result
