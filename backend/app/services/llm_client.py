"""Optional external LLM (OpenAI-compatible API)."""

from __future__ import annotations

import httpx

from app.core.config import settings


class LLMError(RuntimeError):
    pass


def _env_api_key() -> str | None:
    key = getattr(settings, "ai_api_key", None)
    if key is None:
        return None
    value = key.get_secret_value().strip()
    return value or None


def llm_available(*, api_key: str | None = None) -> bool:
    """True when an account key or platform AI_API_KEY is present."""
    if api_key and api_key.strip():
        return True
    return bool(_env_api_key())


def resolve_llm_config(
    *,
    api_key: str | None = None,
    api_base_url: str | None = None,
    model: str | None = None,
) -> tuple[str, str, str] | None:
    """Return (api_key, base_url, model) preferring account overrides, else env."""
    resolved_key = (api_key or "").strip() or _env_api_key()
    if not resolved_key:
        return None
    base_url = (api_base_url or "").strip() or getattr(settings, "ai_api_base_url", "https://api.openai.com/v1")
    resolved_model = (model or "").strip() or getattr(settings, "ai_model", "gpt-4o-mini")
    return resolved_key, base_url.rstrip("/"), resolved_model


async def chat_completion(
    *,
    user_prompt: str,
    system_prompt: str | None = None,
    api_key: str | None = None,
    api_base_url: str | None = None,
    model: str | None = None,
    temperature: float = 0.4,
    max_tokens: int = 600,
) -> str | None:
    config = resolve_llm_config(api_key=api_key, api_base_url=api_base_url, model=model)
    if config is None:
        return None

    resolved_key, base_url, resolved_model = config
    payload = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": system_prompt or "You are a helpful assistant."},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
    if response.is_error:
        raise LLMError(response.text[:500])
    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        return None
    content = choices[0].get("message", {}).get("content")
    return str(content).strip() if content else None


async def enhance_reply(
    *,
    user_prompt: str,
    system_prompt: str | None = None,
    tone: str = "friendly",
    language: str = "ar",
    api_key: str | None = None,
    api_base_url: str | None = None,
    model: str | None = None,
) -> str | None:
    default_system = (
        f"You are a WhatsApp customer support agent. Reply in {language}. "
        f"Tone: {tone}. Use only facts from the provided context. Keep replies concise."
    )
    return await chat_completion(
        user_prompt=user_prompt,
        system_prompt=system_prompt or default_system,
        api_key=api_key,
        api_base_url=api_base_url,
        model=model,
        temperature=0.4,
        max_tokens=600,
    )


async def generate_image_png(
    *,
    prompt: str,
    api_key: str | None = None,
    api_base_url: str | None = None,
    model: str | None = None,
    size: str = "1024x1024",
) -> bytes:
    """Generate a PNG via OpenAI-compatible /images/generations (b64 preferred)."""
    config = resolve_llm_config(api_key=api_key, api_base_url=api_base_url, model=model)
    if config is None:
        raise LLMError("LLM_NOT_CONFIGURED")

    resolved_key, base_url, _resolved_model = config
    image_model = (model or "").strip() or "dall-e-3"
    payload = {
        "model": image_model,
        "prompt": prompt[:3500],
        "n": 1,
        "size": size,
        "response_format": "b64_json",
    }
    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(f"{base_url}/images/generations", headers=headers, json=payload)
    if response.is_error:
        raise LLMError(response.text[:500])
    data = response.json()
    items = data.get("data") or []
    if not items:
        raise LLMError("EMPTY_IMAGE_RESPONSE")
    item = items[0]
    b64 = item.get("b64_json")
    if b64:
        import base64

        return base64.b64decode(b64)
    url = item.get("url")
    if not url:
        raise LLMError("EMPTY_IMAGE_RESPONSE")
    async with httpx.AsyncClient(timeout=90.0) as client:
        image_response = await client.get(url)
    if image_response.is_error:
        raise LLMError(image_response.text[:500])
    return image_response.content
