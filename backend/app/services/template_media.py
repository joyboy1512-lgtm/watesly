"""Helpers for WhatsApp template headers with image/video/document media."""

from __future__ import annotations

HEADER_FORMATS = {"IMAGE", "VIDEO", "DOCUMENT"}


def content_type_to_header_format(content_type: str | None) -> str | None:
    if not content_type:
        return None
    lowered = content_type.lower()
    if lowered.startswith("image/"):
        return "IMAGE"
    if lowered.startswith("video/"):
        return "VIDEO"
    if lowered == "application/pdf":
        return "DOCUMENT"
    return None


def get_template_header_info(components: list | None) -> dict | None:
    for component in components or []:
        comp_type = str(component.get("type", "")).upper()
        if comp_type != "HEADER":
            continue
        header_format = str(component.get("format", "")).upper()
        if header_format not in HEADER_FORMATS:
            continue
        media_url = component.get("media_url") or component.get("url")
        if not media_url and component.get("example"):
            example = component["example"]
            if isinstance(example, dict):
                handles = example.get("header_url") or example.get("header_handle") or []
                if handles:
                    media_url = handles[0]
        if media_url:
            return {
                "format": header_format,
                "media_url": str(media_url),
                "filename": component.get("filename"),
            }
    return None


def build_stored_components(
    *,
    body_text: str | None,
    header_format: str | None = None,
    media_url: str | None = None,
    filename: str | None = None,
) -> list[dict]:
    components: list[dict] = []
    if header_format and media_url:
        header_format = header_format.upper()
        if header_format in HEADER_FORMATS:
            components.append(
                {
                    "type": "HEADER",
                    "format": header_format,
                    "media_url": media_url,
                    "filename": filename,
                }
            )
    if body_text:
        components.append({"type": "BODY", "text": body_text})
    return components


def build_send_components(
    stored_components: list | None,
    *,
    media_url: str | None = None,
    filename: str | None = None,
) -> list[dict]:
    header = get_template_header_info(stored_components)
    if not header and not media_url:
        return []

    fmt = (header or {}).get("format", "IMAGE")
    url = media_url or (header or {}).get("media_url")
    doc_name = filename or (header or {}).get("filename") or "file.pdf"
    if not url:
        return []

    fmt = str(fmt).upper()
    if fmt == "DOCUMENT":
        parameter = {
            "type": "document",
            "document": {"link": url, "filename": doc_name},
        }
    elif fmt == "VIDEO":
        parameter = {"type": "video", "video": {"link": url}}
    else:
        parameter = {"type": "image", "image": {"link": url}}

    return [{"type": "header", "parameters": [parameter]}]


def resolve_send_components(
    stored_components: list | None,
    recipient_parameters: list | None,
    *,
    media_url: str | None = None,
    filename: str | None = None,
) -> list[dict]:
    if recipient_parameters:
        return recipient_parameters
    return build_send_components(stored_components, media_url=media_url, filename=filename)
