"""Optional external LLM (OpenAI-compatible API)."""

from __future__ import annotations

import base64
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class LLMError(RuntimeError):
    pass


DEFAULT_IMAGE_MODELS = (
    "gpt-image-1",
    "dall-e-3",
    "dall-e-2",
)


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


def _image_bytes_from_response(data: dict) -> bytes | None:
    items = data.get("data") or []
    if not items:
        return None
    item = items[0]
    b64 = item.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    return None


async def _download_image(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=90.0) as client:
        image_response = await client.get(url)
    if image_response.is_error:
        raise LLMError(image_response.text[:500])
    content_type = (image_response.headers.get("content-type") or "").lower()
    body = image_response.content
    if not body:
        raise LLMError("EMPTY_IMAGE_BODY")
    if "image/" not in content_type and not body.startswith(b"\x89PNG") and body[:2] != b"\xff\xd8":
        # Still accept if bytes look binary enough
        if len(body) < 64:
            raise LLMError("INVALID_IMAGE_BODY")
    return body


async def generate_image_png(
    *,
    prompt: str,
    api_key: str | None = None,
    api_base_url: str | None = None,
    model: str | None = None,
    size: str = "1024x1024",
) -> bytes:
    """Generate an image via OpenAI-compatible /images/generations with model fallbacks."""
    config = resolve_llm_config(api_key=api_key, api_base_url=api_base_url, model=model)
    if config is None:
        raise LLMError("LLM_NOT_CONFIGURED")

    resolved_key, base_url, chat_model = config
    preferred = (model or "").strip()
    candidates: list[str] = []
    for item in (preferred, *DEFAULT_IMAGE_MODELS):
        if item and item not in candidates and item != chat_model:
            candidates.append(item)
    # If chat model itself is an image model name, try it first
    if preferred:
        candidates.insert(0, preferred)
    # Unique preserve order
    seen: set[str] = set()
    models: list[str] = []
    for item in candidates:
        if item not in seen:
            seen.add(item)
            models.append(item)
    if not models:
        models = list(DEFAULT_IMAGE_MODELS)

    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    clean_prompt = prompt[:3500]
    sizes = [size, "1024x1024", "512x512"]
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=120.0) as client:
        for image_model in models:
            for image_size in sizes:
                payloads = [
                    {
                        "model": image_model,
                        "prompt": clean_prompt,
                        "n": 1,
                        "size": image_size,
                        "response_format": "b64_json",
                    },
                    {
                        "model": image_model,
                        "prompt": clean_prompt,
                        "n": 1,
                        "size": image_size,
                    },
                ]
                # gpt-image-1 often rejects response_format / some sizes
                if image_model.startswith("gpt-image"):
                    payloads = [
                        {
                            "model": image_model,
                            "prompt": clean_prompt,
                            "n": 1,
                            "size": image_size,
                        },
                        {
                            "model": image_model,
                            "prompt": clean_prompt,
                        },
                    ]
                for payload in payloads:
                    try:
                        response = await client.post(
                            f"{base_url}/images/generations",
                            headers=headers,
                            json=payload,
                        )
                    except httpx.HTTPError as exc:
                        errors.append(f"{image_model}:{type(exc).__name__}")
                        continue
                    if response.is_error:
                        errors.append(f"{image_model}:{response.status_code}:{response.text[:180]}")
                        continue
                    data = response.json()
                    raw = _image_bytes_from_response(data)
                    if raw:
                        return raw
                    url = (data.get("data") or [{}])[0].get("url")
                    if url:
                        try:
                            return await _download_image(url)
                        except LLMError as exc:
                            errors.append(f"{image_model}:download:{exc}")
                            continue
                    errors.append(f"{image_model}:empty")

    logger.warning("image generation failed candidates=%s errors=%s", models, errors[:8])
    raise LLMError("; ".join(errors[:4]) or "IMAGE_GENERATION_FAILED")
