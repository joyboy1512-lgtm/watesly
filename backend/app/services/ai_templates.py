"""AI helpers for WhatsApp template draft generation and refinement."""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.knowledge_base import _account_llm_api_key, get_agent_settings
from app.services.llm_client import (
    LLMError,
    chat_completion,
    edit_image_png,
    generate_image_png,
    llm_available,
)
from app.services.meta_template_submit import normalize_template_name


TEMPLATE_SYSTEM_PROMPT = """You are a WhatsApp Business template expert for Meta approval.
Return ONLY valid JSON (no markdown) with this shape:
{
  "name": "snake_case_english_name",
  "language": "ar",
  "category": "marketing" | "utility",
  "header_type": "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "NONE",
  "header_text": "optional short header up to 60 chars (only when header_type is TEXT)",
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
- Always include at least one useful button when the topic is marketing/sales (URL or QUICK_REPLY).
- Max 3 buttons. Marketing templates may include opt-out style quick replies.
- Fill footer_text when helpful (brand or opt-out hint).
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
    if header_type not in {"TEXT", "IMAGE", "VIDEO", "DOCUMENT", "NONE", ""}:
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


IDEA_CHAT_SYSTEM_PROMPT = """أنت مساعد قوالب واتساب كامل القدرات عبر مزود الذكاء الاصطناعي.
يمكنك من خلال هذه الدردشة تنفيذ أي مهمة متاحة للمزود:
- الإجابة والاستشارة (answer)
- إنشاء مسودة قالب كاملة (create_draft)
- تعديل المسودة الحالية حسب تعليمات (refine_draft)
- توليد صورة رأس جديدة (generate_image)
- تعديل صورة رأس موجودة (edit_image)
- اقتراح 3 زوايا/بدائل للموضوع (create_alternatives)

ردّ بالعربية باختصار ووضوح. في نهاية كل رد ضع JSON فقط:

```json
{
  "action":"answer|create_draft|refine_draft|generate_image|edit_image|create_alternatives",
  "topic_summary":"...موضوع القالب...",
  "refine_instruction":"...تعليمات تعديل المسودة إن لزم...",
  "image_prompt":"English visual prompt when image action",
  "suggested_category":"marketing",
  "suggested_header":"IMAGE",
  "ready_for_draft":false,
  "ready_for_image":false,
  "execute_now":false
}
```

قواعد اختيار action:
- إذا طلب المستخدم صراحة إنشاء/توليد مسودة أو قال «اعتمد وأنشئ» → action=create_draft و execute_now=true.
- إذا طلب تعديل النص/الأزرار/التذييل على مسودة موجودة → refine_draft و execute_now=true مع refine_instruction.
- إذا طلب توليد صورة جديدة → generate_image و execute_now=true مع image_prompt إنجليزي.
- إذا طلب تعديل صورة مرفوعة/حالية → edit_image و execute_now=true.
- إذا طلب 3 بدائل/زوايا → create_alternatives و execute_now=true.
- إن كانت التفاصيل ناقصة → action=answer و execute_now=false واسأل سؤالاً واحداً.
- suggested_category: marketing|utility|authentication
- suggested_header: NONE|TEXT|IMAGE|VIDEO|DOCUMENT
"""


def _normalize_idea_messages(messages: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in messages or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        out.append({"role": role, "content": content[:4000]})
    return out[-24:]


def _parse_idea_chat_payload(raw: str) -> dict[str, Any]:
    reply = (raw or "").strip()
    meta: dict[str, Any] = {
        "action": "answer",
        "topic_summary": None,
        "refine_instruction": None,
        "ready_for_draft": False,
        "suggested_category": "marketing",
        "suggested_header": "NONE",
        "image_prompt": None,
        "ready_for_image": False,
        "execute_now": False,
    }
    match = re.search(r"```json\s*(\{.*?\})\s*```", reply, flags=re.DOTALL | re.IGNORECASE)
    bare = re.search(
        r"\{\s*\"(?:action|topic_summary|image_prompt|ready_for_draft|ready_for_image|execute_now)\".*\}",
        reply,
        flags=re.DOTALL,
    )
    json_blob = match.group(1) if match else (bare.group(0) if bare else None)
    cut_match = match or bare
    if json_blob:
        try:
            parsed = json.loads(json_blob)
            if isinstance(parsed, dict):
                action = str(parsed.get("action") or "answer").strip().lower()
                if action not in {
                    "answer",
                    "create_draft",
                    "refine_draft",
                    "generate_image",
                    "edit_image",
                    "create_alternatives",
                }:
                    action = "answer"
                meta["action"] = action
                summary = str(parsed.get("topic_summary") or "").strip()
                meta["topic_summary"] = summary[:2000] or None
                refine = str(parsed.get("refine_instruction") or "").strip()
                meta["refine_instruction"] = refine[:2000] or None
                meta["ready_for_draft"] = bool(parsed.get("ready_for_draft")) or action == "create_draft"
                meta["ready_for_image"] = bool(parsed.get("ready_for_image")) or action in {
                    "generate_image",
                    "edit_image",
                }
                meta["execute_now"] = bool(parsed.get("execute_now"))
                image_prompt = str(parsed.get("image_prompt") or "").strip()
                meta["image_prompt"] = image_prompt[:1200] or None
                category = str(parsed.get("suggested_category") or "marketing").strip().lower()
                if category not in {"marketing", "utility", "authentication"}:
                    category = "marketing"
                meta["suggested_category"] = category
                header = str(parsed.get("suggested_header") or "NONE").strip().upper()
                if header not in {"NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"}:
                    header = "NONE"
                if meta["image_prompt"] or meta["ready_for_image"] or action in {
                    "generate_image",
                    "edit_image",
                }:
                    header = "IMAGE"
                meta["suggested_header"] = header
        except json.JSONDecodeError:
            pass
        if cut_match:
            reply = (reply[: cut_match.start()] + reply[cut_match.end() :]).strip()
    reply = re.sub(r"\n{3,}", "\n\n", reply).strip()
    if not reply:
        reply = "جاهز — يمكنك طلب إنشاء مسودة، تعديلها، توليد صورة، أو تعديل صورة من نفس الدردشة."
    return {"reply": reply, **meta}


def _infer_action_from_user_text(text: str, *, has_draft: bool, has_image: bool) -> str | None:
    lowered = text.lower()
    arabic = text
    if any(k in arabic for k in ("3 بدائل", "ثلاث بدائل", "ثلاثة بدائل", "زوايا")) or "alternativ" in lowered:
        return "create_alternatives"
    if any(k in arabic for k in ("عدّل الصورة", "عدل الصورة", "تعديل الصورة", "غيّر الصورة", "غير الصورة")):
        return "edit_image" if has_image else "generate_image"
    if any(k in arabic for k in ("ولّد صورة", "ولد صورة", "توليد صورة", "اصنع صورة", "أنشئ صورة", "انشئ صورة")):
        return "generate_image"
    if has_draft and any(
        k in arabic for k in ("عدّل المسودة", "عدل المسودة", "عدّل النص", "عدل النص", "حسّن القالب", "حسن القالب", "عدّل الأزرار", "عدل الازرار")
    ):
        return "refine_draft"
    if any(
        k in arabic
        for k in (
            "أنشئ مسودة",
            "انشئ مسودة",
            "ولّد مسودة",
            "ولد مسودة",
            "توليد مسودة",
            "اعتمد",
            "إنشاء مسودة",
            "انشاء مسودة",
        )
    ):
        return "create_draft"
    return None


async def chat_template_idea(
    db: AsyncSession,
    *,
    account_id: UUID,
    messages: list[dict[str, Any]],
    brand_hint: str | None = None,
    has_reference_image: bool = False,
    current_image_prompt: str | None = None,
    current_draft: dict[str, Any] | None = None,
    source_file_id: UUID | None = None,
    language: str = "ar",
    user_id: UUID | None = None,
    auto_execute: bool = True,
) -> dict[str, Any]:
    history = _normalize_idea_messages(messages)
    if not history:
        raise ValueError("EMPTY_IDEA_CHAT")
    if history[-1]["role"] != "user":
        raise ValueError("EMPTY_IDEA_CHAT")
    llm = await _llm_kwargs(db, account_id)
    system = IDEA_CHAT_SYSTEM_PROMPT
    extras: list[str] = []
    if brand_hint:
        extras.append(f"Brand / business: {brand_hint.strip()[:500]}")
    if has_reference_image or source_file_id:
        extras.append(
            "A reference header image is available. Prefer edit_image when the user asks to change it."
        )
    if current_image_prompt:
        extras.append(f"Current image prompt: {current_image_prompt.strip()[:800]}")
    if isinstance(current_draft, dict) and current_draft.get("body_text"):
        extras.append(
            "Current draft JSON snapshot:\n"
            + json.dumps(
                {
                    "name": current_draft.get("name"),
                    "category": current_draft.get("category"),
                    "header_type": current_draft.get("header_type"),
                    "body_text": str(current_draft.get("body_text") or "")[:500],
                    "footer_text": current_draft.get("footer_text"),
                    "buttons": current_draft.get("buttons") or [],
                },
                ensure_ascii=False,
            )
        )
    if extras:
        system = system + "\n" + "\n".join(extras)
    try:
        raw = await chat_completion(
            messages=history,
            system_prompt=system,
            temperature=0.45,
            max_tokens=1400,
            **llm,
        )
    except LLMError as exc:
        raise ValueError(f"LLM_FAILED:{exc}") from exc
    if not raw:
        raise ValueError("EMPTY_AI_RESPONSE")
    parsed = _parse_idea_chat_payload(raw)
    last_user = history[-1]["content"]
    if not parsed.get("topic_summary") and parsed.get("action") in {
        "create_draft",
        "create_alternatives",
        "answer",
    }:
        parsed["topic_summary"] = last_user[:2000]

    inferred = _infer_action_from_user_text(
        last_user,
        has_draft=bool(isinstance(current_draft, dict) and current_draft.get("body_text")),
        has_image=bool(has_reference_image or source_file_id),
    )
    if inferred and (parsed.get("action") == "answer" or parsed.get("execute_now")):
        parsed["action"] = inferred
        parsed["execute_now"] = True
        if inferred in {"generate_image", "edit_image"} and not parsed.get("image_prompt"):
            parsed["image_prompt"] = (current_image_prompt or last_user)[:1200]
            parsed["ready_for_image"] = True
        if inferred == "refine_draft" and not parsed.get("refine_instruction"):
            parsed["refine_instruction"] = last_user[:2000]
        if inferred in {"create_draft", "create_alternatives"} and not parsed.get("topic_summary"):
            parsed["topic_summary"] = last_user[:2000]
            parsed["ready_for_draft"] = True

    result: dict[str, Any] = {
        **parsed,
        "executed": False,
        "draft": None,
        "alternatives": [],
        "image": None,
        "capabilities": [
            "answer",
            "create_draft",
            "refine_draft",
            "generate_image",
            "edit_image",
            "create_alternatives",
        ],
    }

    if not auto_execute or not parsed.get("execute_now"):
        return result

    action = str(parsed.get("action") or "answer")
    try:
        if action == "create_draft":
            topic = str(parsed.get("topic_summary") or last_user).strip()
            draft = await generate_template_draft(
                db,
                account_id=account_id,
                topic=topic,
                language=language or "ar",
                category=parsed.get("suggested_category"),
                brand_hint=brand_hint,
            )
            if parsed.get("suggested_header") and parsed["suggested_header"] != "NONE":
                draft["header_type"] = parsed["suggested_header"]
            if parsed.get("image_prompt"):
                draft["image_prompt"] = parsed["image_prompt"]
            result["draft"] = draft
            result["executed"] = True
            result["reply"] = f"{parsed['reply']}\n\n✓ تم إنشاء المسودة بالكامل من الشات."
        elif action == "refine_draft":
            if not isinstance(current_draft, dict) or not current_draft.get("body_text"):
                result["reply"] = f"{parsed['reply']}\n\nلا توجد مسودة حالياً لتعديلها — أنشئ مسودة أولاً."
            else:
                instruction = str(parsed.get("refine_instruction") or last_user).strip()
                draft = await refine_template_draft(
                    db,
                    account_id=account_id,
                    draft=current_draft,
                    instruction=instruction,
                )
                result["draft"] = draft
                result["executed"] = True
                result["reply"] = f"{parsed['reply']}\n\n✓ تم تعديل المسودة حسب طلبك."
        elif action == "create_alternatives":
            topic = str(parsed.get("topic_summary") or last_user).strip()
            angles = ["عرض سعر", "ندرة / كمية محدودة", "فائدة المنتج"]
            alts: list[dict[str, Any]] = []
            for angle in angles:
                alts.append(
                    await generate_template_draft(
                        db,
                        account_id=account_id,
                        topic=f"{topic} — زاوية: {angle}",
                        language=language or "ar",
                        category=parsed.get("suggested_category"),
                        brand_hint=brand_hint,
                    )
                )
            result["alternatives"] = alts
            result["draft"] = alts[0] if alts else None
            result["executed"] = True
            result["reply"] = f"{parsed['reply']}\n\n✓ تم توليد 3 بدائل من الشات."
        elif action in {"generate_image", "edit_image"}:
            prompt = str(parsed.get("image_prompt") or current_image_prompt or last_user).strip()
            image = await generate_template_header_image(
                db,
                account_id=account_id,
                prompt=prompt,
                user_id=user_id,
                source_file_id=source_file_id if action == "edit_image" else None,
                edit_mode=action == "edit_image" and bool(source_file_id),
            )
            result["image"] = image
            result["image_prompt"] = prompt
            result["executed"] = True
            result["reply"] = (
                f"{parsed['reply']}\n\n✓ تم {'تعديل' if action == 'edit_image' else 'توليد'} صورة الرأس من الشات."
            )
    except ValueError as exc:
        result["executed"] = False
        result["reply"] = f"{parsed['reply']}\n\nتعذر التنفيذ: {exc}"
    return result


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
            temperature=0.45,
            max_tokens=1800,
            **llm,
        )
    except LLMError as exc:
        raise ValueError(f"LLM_FAILED:{exc}") from exc
    if not raw:
        raise ValueError("EMPTY_AI_RESPONSE")
    try:
        return normalize_template_draft(_extract_json_object(raw))
    except ValueError as exc:
        raise ValueError(f"INVALID_AI_DRAFT:{exc}") from exc


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
            temperature=0.35,
            max_tokens=1800,
            **llm,
        )
    except LLMError as exc:
        raise ValueError(f"LLM_FAILED:{exc}") from exc
    if not raw:
        raise ValueError("EMPTY_AI_RESPONSE")
    try:
        return normalize_template_draft(_extract_json_object(raw))
    except ValueError as exc:
        raise ValueError(f"INVALID_AI_DRAFT:{exc}") from exc


async def generate_template_header_image(
    db: AsyncSession,
    *,
    account_id: UUID,
    prompt: str,
    user_id: UUID | None = None,
    source_file_id: UUID | None = None,
    edit_mode: bool = False,
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

    source_bytes: bytes | None = None
    if source_file_id:
        source = await db.get(UploadedFile, source_file_id)
        if source is None or source.account_id != account_id:
            raise ValueError("SOURCE_IMAGE_NOT_FOUND")
        try:
            source_bytes = storage.download_bytes(source.object_key)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"SOURCE_IMAGE_READ_FAILED:{exc}") from exc

    try:
        if edit_mode and source_bytes:
            png_bytes = await edit_image_png(
                prompt=prompt_clean,
                image_bytes=source_bytes,
                api_key=account_key,
                api_base_url=settings.llm_api_base_url,
                model=image_model,
            )
        else:
            png_bytes = await generate_image_png(
                prompt=prompt_clean,
                api_key=account_key,
                api_base_url=settings.llm_api_base_url,
                model=image_model,
            )
    except LLMError as exc:
        raise ValueError(f"IMAGE_FAILED:{exc}") from exc

    filename = "ai-template-header-edit.png" if edit_mode else "ai-template-header.png"
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
