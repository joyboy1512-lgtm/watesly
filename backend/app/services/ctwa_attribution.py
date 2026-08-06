"""Click-to-WhatsApp and referral attribution from Meta inbound payloads."""

from __future__ import annotations

from app.models.contact import Contact


def extract_referral_fields(message_item: dict) -> dict:
    referral = message_item.get("referral") or {}
    if not isinstance(referral, dict) or not referral:
        return {}
    source_type = str(referral.get("source_type") or "").strip()
    source_id = str(referral.get("source_id") or "").strip()
    headline = str(referral.get("headline") or "").strip()
    return {
        "referral_json": referral,
        "utm_source": source_type or "whatsapp_ad",
        "utm_campaign": headline or source_id or None,
    }


def apply_referral_to_contact(contact: Contact, fields: dict) -> None:
    if not fields:
        return
    if fields.get("referral_json"):
        contact.referral_json = fields["referral_json"]
    if fields.get("utm_source"):
        contact.utm_source = str(fields["utm_source"])[:120]
    if fields.get("utm_campaign"):
        contact.utm_campaign = str(fields["utm_campaign"])[:160]
