"""Mask sensitive contact fields for restricted roles."""

from __future__ import annotations

import re

from app.core.permissions import Permission
from app.models.membership import MembershipRole


PHONE_RE = re.compile(r"(\d{3,4})(\d+)(\d{2})")


def can_view_full_contact(*, role: str, permissions: set[str]) -> bool:
    if role in {MembershipRole.OWNER.value, MembershipRole.ADMIN.value, MembershipRole.MANAGER.value}:
        return True
    return Permission.CONTACTS_EDIT in permissions


def mask_phone(value: str | None) -> str | None:
    if not value:
        return value
    digits = re.sub(r"\D", "", value)
    if len(digits) < 6:
        return "***"
    return f"{digits[:3]}***{digits[-2:]}"


def mask_email(value: str | None) -> str | None:
    if not value or "@" not in value:
        return value
    local, domain = value.split("@", 1)
    if len(local) <= 2:
        return f"**@{domain}"
    return f"{local[:2]}***@{domain}"


def mask_contact_fields(data: dict, *, show_full: bool) -> dict:
    if show_full:
        return data
    masked = dict(data)
    if "external_address" in masked:
        masked["external_address"] = mask_phone(str(masked["external_address"])) or masked["external_address"]
    if "email" in masked:
        masked["email"] = mask_email(masked.get("email"))
    if "phone" in masked:
        masked["phone"] = mask_phone(str(masked.get("phone")))
    return masked
