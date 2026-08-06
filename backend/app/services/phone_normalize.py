"""Normalize phone numbers for Meta WhatsApp API (E.164 digits without +)."""

from __future__ import annotations

import re

DEFAULT_COUNTRY_CODE = "965"


def normalize_whatsapp_phone(value: str | None, *, country_code: str = DEFAULT_COUNTRY_CODE) -> str:
    """Return digits-only WhatsApp address. Kuwait: 050… → 9655…"""
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return ""
    cc = re.sub(r"\D", "", country_code) or DEFAULT_COUNTRY_CODE
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0") and cc == "965":
        digits = cc + digits[1:]
    elif not digits.startswith(cc) and len(digits) <= 11:
        local = digits.lstrip("0")
        if local:
            digits = cc + local
    return digits
