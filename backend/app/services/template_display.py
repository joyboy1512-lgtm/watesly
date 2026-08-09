"""Render WhatsApp template content for inbox display."""

from __future__ import annotations


def render_template_body_text(components: list | None, *, fallback: str | None = None) -> str | None:
    for component in components or []:
        if str(component.get("type", "")).upper() == "BODY":
            text = component.get("text")
            if text:
                return str(text).strip()
    if fallback and fallback.strip():
        return fallback.strip()
    return None


def extract_template_fields(provider_payload: dict | None) -> dict:
    if not isinstance(provider_payload, dict):
        return {"template_name": None, "template_components": None}

    components = provider_payload.get("components")
    if not isinstance(components, list) or not components:
        components = None

    template_name = provider_payload.get("template_name")
    return {
        "template_name": str(template_name) if template_name else None,
        "template_components": components,
    }
