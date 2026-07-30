"""Optional external LLM (OpenAI-compatible API)."""

from __future__ import annotations

import httpx

from app.core.config import settings


class LLMError(RuntimeError):
    pass


def llm_available() -> bool:
    key = getattr(settings, "ai_api_key", None)
    return bool(key and key.get_secret_value().strip())


async def enhance_reply(
    *,
    user_prompt: str,
    system_prompt: str | None = None,
    tone: str = "friendly",
    language: str = "ar",
) -> str | None:
    if not llm_available():
        return None

    base_url = getattr(settings, "ai_api_base_url", "https://api.openai.com/v1").rstrip("/")
    model = getattr(settings, "ai_model", "gpt-4o-mini")
    default_system = (
        f"You are a WhatsApp customer support agent. Reply in {language}. "
        f"Tone: {tone}. Use only facts from the provided context. Keep replies concise."
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt or default_system},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.4,
        "max_tokens": 600,
    }
    headers = {
        "Authorization": f"Bearer {settings.ai_api_key.get_secret_value()}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
    if response.is_error:
        raise LLMError(response.text[:500])
    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        return None
    content = choices[0].get("message", {}).get("content")
    return str(content).strip() if content else None
