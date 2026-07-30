"""Template variable substitution for quick replies and campaigns."""

import re
from typing import Any

_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def render_template(text: str, context: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        value = context
        for part in key.split("."):
            if isinstance(value, dict):
                value = value.get(part)
            else:
                value = None
                break
        return str(value) if value is not None else match.group(0)

    return _VAR_PATTERN.sub(replace, text)


def build_contact_context(contact) -> dict[str, Any]:
    return {
        "contact": {
            "name": contact.display_name or "",
            "phone": contact.external_address,
            "email": contact.email or "",
            "language": contact.language or "",
            "country": contact.country_code or "",
        }
    }
