"""Build Meta API payloads and submit WhatsApp message templates."""

from __future__ import annotations

import re
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.storage import storage
from app.services.template_media import get_template_header_info

_TEMPLATE_NAME_RE = re.compile(r"[^a-z0-9_]")
_BODY_VAR_RE = re.compile(r"\{\{(\d+)\}\}")

_MIME_BY_FORMAT = {
    "IMAGE": "image/jpeg",
    "VIDEO": "video/mp4",
    "DOCUMENT": "application/pdf",
}


def normalize_template_name(name: str) -> str:
    normalized = name.strip().lower().replace(" ", "_").replace("-", "_")
    normalized = _TEMPLATE_NAME_RE.sub("", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not normalized:
        raise ValueError("INVALID_TEMPLATE_NAME")
    return normalized[:512]


def _extract_body_text(components: list | None) -> str | None:
    for component in components or []:
        if str(component.get("type", "")).upper() == "BODY":
            text = (component.get("text") or "").strip()
            if text:
                return text
    return None


def _extract_footer_text(components: list | None) -> str | None:
    for component in components or []:
        if str(component.get("type", "")).upper() == "FOOTER":
            text = (component.get("text") or "").strip()
            if text:
                return text
    return None


def _extract_buttons(components: list | None) -> list[dict]:
    for component in components or []:
        if str(component.get("type", "")).upper() == "BUTTONS":
            buttons = component.get("buttons") or []
            return [button for button in buttons if isinstance(button, dict)]
    return []


def _build_meta_buttons(buttons: list[dict]) -> list[dict]:
    meta_buttons: list[dict] = []
    for button in buttons[:3]:
        button_type = str(button.get("type", "QUICK_REPLY")).upper()
        text = str(button.get("text", "")).strip()[:25]
        if not text:
            continue
        if button_type == "URL":
            url = str(button.get("url", "")).strip()
            if not url:
                continue
            meta_buttons.append({"type": "URL", "text": text, "url": url, "example": [url]})
        elif button_type == "PHONE_NUMBER":
            phone = str(button.get("phone_number", "")).strip()
            if not phone:
                continue
            meta_buttons.append({"type": "PHONE_NUMBER", "text": text, "phone_number": phone})
        else:
            meta_buttons.append({"type": "QUICK_REPLY", "text": text})
    return meta_buttons


async def _fetch_header_media(media_url: str, file_name: str, header_format: str) -> tuple[bytes, str]:
    object_key = storage.key_from_public_url(media_url)
    if object_key:
        try:
            content = storage.download_bytes(object_key)
            return content, _MIME_BY_FORMAT.get(header_format, "application/octet-stream")
        except Exception as exc:
            # Fall back to public URL fetch when direct storage read fails.
            pass

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as http:
        try:
            response = await http.get(media_url)
        except httpx.HTTPError as exc:
            raise MetaAPIError(
                "Unable to fetch header media URL",
                status_code=502,
                response_data={"url": media_url, "error": str(exc)},
            ) from exc
        if response.is_error:
            raise MetaAPIError(
                "Unable to fetch header media for Meta submission",
                status_code=response.status_code,
                response_data={"url": media_url},
            )
        mime_type = (
            response.headers.get("content-type")
            or _MIME_BY_FORMAT.get(header_format, "application/octet-stream")
        ).split(";")[0]
        return response.content, mime_type


async def build_meta_template_components(
    stored_components: list | None,
    *,
    client: MetaWhatsAppClient,
) -> list[dict]:
    meta_components: list[dict] = []
    header = get_template_header_info(stored_components)
    if header:
        media_url = header["media_url"]
        file_name = header.get("filename") or "header_sample.bin"
        file_bytes, mime_type = await _fetch_header_media(
            media_url,
            file_name,
            header["format"],
        )
        handle = await client.upload_template_sample(
            file_name=file_name,
            file_bytes=file_bytes,
            mime_type=mime_type,
        )
        meta_components.append(
            {
                "type": "HEADER",
                "format": header["format"],
                "example": {"header_handle": [handle]},
            }
        )

    body_text = _extract_body_text(stored_components)
    if not body_text:
        raise ValueError("BODY_REQUIRED")

    body_component: dict = {"type": "BODY", "text": body_text}
    variables = _BODY_VAR_RE.findall(body_text)
    if variables:
        count = max(int(value) for value in variables)
        body_component["example"] = {"body_text": [["مثال"] * count]}
    meta_components.append(body_component)

    footer_text = _extract_footer_text(stored_components)
    if footer_text:
        meta_components.append({"type": "FOOTER", "text": footer_text[:60]})

    buttons = _build_meta_buttons(_extract_buttons(stored_components))
    if buttons:
        meta_components.append({"type": "BUTTONS", "buttons": buttons})

    return meta_components


async def submit_template_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
) -> WhatsAppTemplate:
    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("TEMPLATE_NOT_FOUND")

    wa = await db.get(WhatsAppAccount, template.whatsapp_account_id)
    if wa is None or wa.account_id != account_id:
        raise ValueError("INVALID_WHATSAPP_ACCOUNT")

    meta_name = normalize_template_name(template.name)
    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    try:
        components = await build_meta_template_components(template.components, client=client)
        response = await client.create_message_template(
            waba_id=wa.waba_id,
            name=meta_name,
            language=template.language,
            category=template.category,
            components=components,
        )
    except MetaAPIError:
        raise
    finally:
        await client.aclose()

    template.name = meta_name
    template.meta_template_id = str(response.get("id")) if response.get("id") else template.meta_template_id
    raw_status = str(response.get("status", "PENDING")).lower()
    try:
        template.status = TemplateStatus(raw_status)
    except ValueError:
        template.status = TemplateStatus.PENDING
    template.meta_status_detail = None
    await db.commit()
    await db.refresh(template)
    return template
