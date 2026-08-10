"""Helpers for WhatsApp template headers with image/video/document media."""

from __future__ import annotations

from urllib.parse import quote, urlparse, urlunparse

HEADER_FORMATS = {"IMAGE", "VIDEO", "DOCUMENT", "CAROUSEL"}
EPHEMERAL_MEDIA_HOSTS = ("scontent.whatsapp.net", "fbcdn.net")


def is_ephemeral_meta_media_url(url: str | None) -> bool:
    if not url:
        return False
    host = (urlparse(str(url).strip()).hostname or "").lower()
    return any(host == item or host.endswith(f".{item}") for item in EPHEMERAL_MEDIA_HOSTS)


def meta_safe_media_url(url: str) -> str:
    """Percent-encode path segments so Meta can fetch URLs with spaces/special chars."""
    parsed = urlparse(str(url).strip())
    if not parsed.scheme or not parsed.netloc:
        return str(url).strip()
    safe_path = quote(parsed.path, safe="/")
    return urlunparse((parsed.scheme, parsed.netloc, safe_path, parsed.params, parsed.query, parsed.fragment))


def _encode_component_media_links(components: list | None) -> list[dict]:
    if not components:
        return []
    encoded: list[dict] = []
    for component in components:
        item = dict(component)
        params = item.get("parameters")
        if isinstance(params, list):
            next_params: list[dict] = []
            for param in params:
                if not isinstance(param, dict):
                    next_params.append(param)
                    continue
                p = dict(param)
                for media_key in ("image", "video", "document"):
                    media = p.get(media_key)
                    if isinstance(media, dict) and media.get("link"):
                        media = dict(media)
                        media["link"] = meta_safe_media_url(str(media["link"]))
                        p[media_key] = media
                next_params.append(p)
            item["parameters"] = next_params
        encoded.append(item)
    return encoded


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
        if header_format == "CAROUSEL":
            cards = component.get("cards") or []
            return {
                "format": "CAROUSEL",
                "card_count": len(cards) if isinstance(cards, list) else 0,
                "media_url": None,
            }
        media_url = component.get("media_url") or component.get("url")
        if (not media_url or is_ephemeral_meta_media_url(str(media_url))) and component.get("example"):
            example = component["example"]
            if isinstance(example, dict):
                handles = example.get("header_url") or example.get("header_handle") or []
                for handle in handles:
                    candidate = str(handle)
                    if candidate and not is_ephemeral_meta_media_url(candidate):
                        media_url = candidate
                        break
        if media_url and not is_ephemeral_meta_media_url(str(media_url)):
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
    if str(fmt).upper() == "CAROUSEL":
        # Carousel cards are defined in the approved Meta template; body params only at send time.
        return []

    url = media_url or (header or {}).get("media_url")
    doc_name = filename or (header or {}).get("filename") or "file.pdf"
    if not url:
        return []

    fmt = str(fmt).upper()
    safe_url = meta_safe_media_url(str(url))
    if fmt == "DOCUMENT":
        parameter = {
            "type": "document",
            "document": {"link": safe_url, "filename": doc_name},
        }
    elif fmt == "VIDEO":
        parameter = {"type": "video", "video": {"link": safe_url}}
    else:
        parameter = {"type": "image", "image": {"link": safe_url}}

    return [{"type": "header", "parameters": [parameter]}]


def _recipient_uses_ephemeral_header_media(recipient_parameters: list | None) -> bool:
    if not recipient_parameters:
        return False
    for component in recipient_parameters:
        if str(component.get("type", "")).lower() != "header":
            continue
        params = component.get("parameters")
        if not isinstance(params, list):
            continue
        for param in params:
            if not isinstance(param, dict):
                continue
            for media_key in ("image", "video", "document"):
                media = param.get(media_key)
                if isinstance(media, dict) and is_ephemeral_meta_media_url(str(media.get("link"))):
                    return True
    return False


def resolve_send_components(
    stored_components: list | None,
    recipient_parameters: list | None,
    *,
    media_url: str | None = None,
    filename: str | None = None,
) -> list[dict]:
    fallback = build_send_components(stored_components, media_url=media_url, filename=filename)
    if not recipient_parameters:
        return fallback
    if _recipient_uses_ephemeral_header_media(recipient_parameters):
        return fallback or _encode_component_media_links(recipient_parameters)
    encoded = _encode_component_media_links(recipient_parameters)
    return encoded or fallback
