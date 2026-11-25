"""AI helpers for WhatsApp template draft generation and refinement."""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.knowledge_base import _account_llm_api_key, get_agent_settings
from app.services.llm_client import LLMError, chat_completion, generate_image_png, llm_available
from app.services.meta_template_submit import normalize_template_name


TEMPLATE_SYSTEM_PROMPT = """You are a WhatsApp Business template expert for Meta approval.
Return ONLY valid JSON (no markdown) with this shape:
{
  "name": "snake_case_english_name",
  "language": "ar",
  "category": "marketing" | "utility",
  "header_type": "TEXT" | "IMAGE" | "NONE",
  "header_text": "optional short header up to 60 chars",
  "body_text": "WhatsApp body. Use {{1}} {{2}} for variables when needed.",
  "body_samples": ["sample for {{1}}", "sample for {{2}}"],
  "footer_text": "optional footer up to 60 chars",
  "buttons": [{"type":"QUICK_REPLY"|"URL"|"PHONE_NUMBER","text":"...","url":"...","phone_number":"..."}],
  "image_prompt": "English visual prompt if header IMAGE else empty string",
  "notes": "short Arabic note for the human reviewer"
}
Rules:
- name must be lowercase snake_case, Meta-safe (letters, numbers, underscore).
- Body max ~1024 chars. Keep Kuwaiti/Arabic friendly tone when language is ar.
- Prefer 0-2 variables. Provide body_samples matching variable count.
- Max 3 buttons. Marketing templates may include opt-out style quick replies.
- Do not invent illegal claims. Keep compliant for Meta review.
"""


def _extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise ValueError("INVALID_AI_JSON")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("INVALID_AI_JSON")
    return data


def normalize_template_draft(data: dict[str, Any]) -> dict[str, Any]:
    category = str(data.get("category") or "marketing").strip().lower()
    if category not in {"marketing", "utility", "authentication"}:
        category = "marketing"
    header_type = str(data.get("header_type") or "NONE").strip().upper()
    if header_type not in {"TEXT", "IMAGE", "NONE", ""}:
        header_type = "NONE"
    if header_type == "":
        header_type = "NONE"

    buttons_raw = data.get("buttons") or []
    buttons: list[dict[str, Any]] = []
    if isinstance(buttons_raw, list):
        for item in buttons_raw[:3]:
            if not isinstance(item, dict):
                continue
            btn_type = str(item.get("type") or "QUICK_REPLY").strip().upper()
            text = str(item.get("text") or "").strip()[:25]
            if not text:
                continue
            entry: dict[str, Any] = {"type": btn_type, "text": text}
            if btn_type == "URL":
                entry["url"] = str(item.get("url") or "").strip()
            if btn_type == "PHONE_NUMBER":
                entry["phone_number"] = str(item.get("phone_number") or "").strip()
            buttons.append(entry)

    samples_raw = data.get("body_samples") or []
    samples = [str(item).strip() for item in samples_raw if str(item).strip()] if isinstance(samples_raw, list) else []

    name = normalize_template_name(str(data.get("name") or "ai_template"))
    language = str(data.get("language") or "ar").strip() or "ar"
    body_text = str(data.get("body_text") or "").strip()
    if not body_text:
        raise ValueError("EMPTY_TEMPLATE_BODY")

    return {
        "name": name,
        "language": language[:20],
        "category": category,
        "header_type": header_type,
        "header_text": str(data.get("header_text") or "").strip()[:60],
        "body_text": body_text[:4096],
        "body_samples": samples[:5],
        "footer_text": str(data.get("footer_text") or "").strip()[:60],
        "buttons": buttons,
        "image_prompt": str(data.get("image_prompt") or "").strip()[:1200],
        "notes": str(data.get("notes") or "").strip()[:500],
    }


async def _llm_kwargs(db: AsyncSession, account_id: UUID) -> dict[str, str | None]:
    settings = await get_agent_settings(db, account_id)
    account_key = _account_llm_api_key(settings)
    if not llm_available(api_key=account_key):
        raise ValueError("LLM_NOT_CONFIGURED")
    return {
        "api_key": account_key,
        "api_base_url": settings.llm_api_base_url,
        "model": settings.llm_model,
    }


async def generate_template_draft(
    db: AsyncSession,
    *,
    account_id: UUID,
    topic: str,
    language: str = "ar",
    category: str | None = None,
    brand_hint: str | None = None,
) -> dict[str, Any]:
    topic_clean = topic.strip()
    if not topic_clean:
        raise ValueError("EMPTY_TOPIC")
    llm = await _llm_kwargs(db, account_id)
    user_prompt = (
        f"Topic: {topic_clean}\n"
        f"Preferred language: {language or 'ar'}\n"
        f"Preferred category: {category or 'auto'}\n"
        f"Brand / business hint: {brand_hint or 'general WhatsApp business'}\n"
        "Create one Meta-ready WhatsApp template draft."
    )
    try:
        raw = await chat_completion(
            user_prompt=user_prompt,
            system_prompt=TEMPLATE_SYSTEM_PROMPT,
            temperature=0.5,
            max_tokens=1200,
            **llm,
        )
    except LLMError as exc:
        raise ValueError(f"LLM_FAILED:{exc}") from exc
    if not raw:
        raise ValueError("EMPTY_AI_RESPONSE")
    return normalize_template_draft(_extract_json_object(raw))


async def refine_template_draft(
    db: AsyncSession,
    *,
    account_id: UUID,
    draft: dict[str, Any],
    instruction: str,
) -> dict[str, Any]:
    instruction_clean = instruction.strip()
    if not instruction_clean:
        raise ValueError("EMPTY_INSTRUCTION")
    current = normalize_template_draft(draft)
    llm = await _llm_kwargs(db, account_id)
    user_prompt = (
        "Improve this WhatsApp template draft according to the instruction.\n"
        f"Instruction: {instruction_clean}\n"
        f"Current draft JSON:\n{json.dumps(current, ensure_ascii=False)}"
    )
    try:
        raw = await chat_completion(
            user_prompt=user_prompt,
            system_prompt=TEMPLATE_SYSTEM_PROMPT,
            temperature=0.4,
            max_tokens=1200,
            **llm,
        )
    except LLMError as exc:
        raise ValueError(f"LLM_FAILED:{exc}") from exc
    if not raw:
        raise ValueError("EMPTY_AI_RESPONSE")
    return normalize_template_draft(_extract_json_object(raw))


async def generate_template_header_image(
    db: AsyncSession,
    *,
    account_id: UUID,
    prompt: str,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    from app.models.uploaded_file import UploadedFile
    from app.services.storage import storage

    prompt_clean = prompt.strip()
    if not prompt_clean:
        raise ValueError("EMPTY_IMAGE_PROMPT")
    settings = await get_agent_settings(db, account_id)
    account_key = _account_llm_api_key(settings)
    if not llm_available(api_key=account_key):
        raise ValueError("LLM_NOT_CONFIGURED")
    image_model = (getattr(settings, "llm_image_model", None) or "").strip() or None
    try:
        png_bytes = await generate_image_png(
            prompt=prompt_clean,
            api_key=account_key,
            api_base_url=settings.llm_api_base_url,
            model=image_model,
        )
    except LLMError as exc:
        raise ValueError(f"IMAGE_FAILED:{exc}") from exc

    filename = "ai-template-header.png"
    key, public_url = storage.upload_bytes(
        account_id=account_id,
        filename=filename,
        content_type="image/png",
        content=png_bytes,
    )
    item = UploadedFile(
        account_id=account_id,
        uploaded_by_user_id=user_id,
        filename=filename,
        content_type="image/png",
        size_bytes=len(png_bytes),
        object_key=key,
        public_url=public_url,
        scan_status="available",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {
        "id": str(item.id),
        "filename": item.filename,
        "content_type": item.content_type,
        "size_bytes": item.size_bytes,
        "object_key": item.object_key,
        "public_url": item.public_url,
        "prompt": prompt_clean,
    }
