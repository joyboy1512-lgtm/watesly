"""Build per-recipient WhatsApp template send parameters."""

from __future__ import annotations

import re

from typing import Callable

from app.models.contact import Contact
from app.services.template_media import build_send_components, get_template_header_info

_BODY_VAR_RE = re.compile(r"\{\{(\d+)\}\}")

CONTACT_FIELD_RESOLVERS: dict[str, Callable[[Contact], str]] = {
    "display_name": lambda c: (c.display_name or c.external_address or "عميل").strip(),
    "external_address": lambda c: c.external_address.strip(),
    "first_name": lambda c: ((c.display_name or "").split()[0] if c.display_name else c.external_address),
}


def extract_body_variable_count(components: list | None) -> int:
    for component in components or []:
        if str(component.get("type", "")).upper() != "BODY":
            continue
        text = component.get("text") or ""
        numbers = [int(value) for value in _BODY_VAR_RE.findall(str(text))]
        return max(numbers) if numbers else 0
    return 0


def resolve_body_values(contact: Contact, mapping: list[str] | None) -> list[str]:
    count = len(mapping or [])
    values: list[str] = []
    for index in range(count):
        key = (mapping or [])[index] if index < len(mapping or []) else "display_name"
        if key.startswith("static:"):
            values.append(key.removeprefix("static:").strip() or "—")
            continue
        resolver = CONTACT_FIELD_RESOLVERS.get(key, CONTACT_FIELD_RESOLVERS["display_name"])
        values.append(str(resolver(contact))[:1000])
    return values


def build_recipient_template_components(
    stored_components: list | None,
    *,
    contact: Contact,
    body_variable_mapping: list[str] | None = None,
    media_url: str | None = None,
    filename: str | None = None,
    explicit_parameters: list[dict] | None = None,
) -> list[dict]:
    if explicit_parameters:
        return explicit_parameters

    components = build_send_components(stored_components, media_url=media_url, filename=filename)
    body_count = extract_body_variable_count(stored_components)
    if body_count > 0:
        mapping = body_variable_mapping or ["display_name"] * body_count
        if len(mapping) < body_count:
            mapping = mapping + ["display_name"] * (body_count - len(mapping))
        values = resolve_body_values(contact, mapping[:body_count])
        components.append(
            {
                "type": "body",
                "parameters": [{"type": "text", "text": value} for value in values],
            }
        )
    return components
