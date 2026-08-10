"""Marketing opt-out detection, template helpers, and contact updates."""

from __future__ import annotations

import re
import unicodedata
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact

MARKETING_OPT_OUT_BUTTON_ID = "watesly_marketing_opt_out"
MARKETING_OPT_OUT_BUTTON_TEXT = "عدم الإزعاج"
MARKETING_OPT_OUT_FOOTER = "أرسل «إيقاف» لإلغاء الاشتراك"

OPT_OUT_KEYWORDS = (
    "stop",
    "unsubscribe",
    "opt out",
    "optout",
    "cancel",
    "remove me",
    "إيقاف",
    "ايقاف",
    "عدم الازعاج",
    "عدم الإزعاج",
    "عدم الإزعاج",
    "لا تراسلني",
    "الغاء الاشتراك",
    "إلغاء الاشتراك",
    "لا اريد",
    "لا أريد",
)

_OPT_OUT_BUTTON_TEXTS = {
    MARKETING_OPT_OUT_BUTTON_ID.lower(),
    MARKETING_OPT_OUT_BUTTON_TEXT.lower(),
    "عدم الازعاج",
    "عدم الازعاج مرة أخرى",
    "إيقاف التسويق",
    "stop promotions",
    "unsubscribe",
}


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text


def is_marketing_opt_out_request(
    *,
    text: str | None = None,
    button_id: str | None = None,
    button_title: str | None = None,
) -> bool:
    normalized_button_id = _normalize_text(button_id)
    if normalized_button_id in _OPT_OUT_BUTTON_TEXTS:
        return True
    if normalized_button_id.startswith("watesly_marketing_opt"):
        return True

    normalized_title = _normalize_text(button_title)
    if normalized_title in _OPT_OUT_BUTTON_TEXTS:
        return True
    if any(token in normalized_title for token in ("إيقاف", "unsubscribe", "opt out", "عدم")):
        return True

    normalized_text = _normalize_text(text)
    if not normalized_text:
        return False
    if normalized_text in {_normalize_text(item) for item in OPT_OUT_KEYWORDS}:
        return True
    return any(_normalize_text(keyword) in normalized_text for keyword in OPT_OUT_KEYWORDS if len(keyword) >= 4)


def template_has_opt_out_button(components: list | None) -> bool:
    for component in components or []:
        if str(component.get("type", "")).upper() != "BUTTONS":
            continue
        for button in component.get("buttons") or []:
            if not isinstance(button, dict):
                continue
            button_type = str(button.get("type", "QUICK_REPLY")).upper()
            if button_type not in {"QUICK_REPLY", "QUICK REPLY"}:
                continue
            text = _normalize_text(button.get("text"))
            button_id = _normalize_text(button.get("id") or button.get("payload"))
            if text in _OPT_OUT_BUTTON_TEXTS or button_id in _OPT_OUT_BUTTON_TEXTS:
                return True
            if button.get("marketing_opt_out") is True:
                return True
            if any(token in text for token in ("إيقاف", "unsubscribe", "opt out", "عدم")):
                return True
    return False


def template_has_opt_out_footer(components: list | None) -> bool:
    for component in components or []:
        if str(component.get("type", "")).upper() != "FOOTER":
            continue
        footer = _normalize_text(component.get("text"))
        if any(token in footer for token in ("إيقاف", "unsubscribe", "opt out", "اشتراك", "تسويق")):
            return True
    return False


def append_marketing_opt_out_components(components: list | None) -> list[dict]:
    """Ensure marketing templates expose an opt-out quick reply and footer hint."""
    next_components = [dict(item) for item in (components or []) if isinstance(item, dict)]
    if template_has_opt_out_button(next_components):
        return next_components

    next_components.append(
        {
            "type": "BUTTONS",
            "buttons": [
                {
                    "type": "QUICK_REPLY",
                    "text": MARKETING_OPT_OUT_BUTTON_TEXT,
                    "id": MARKETING_OPT_OUT_BUTTON_ID,
                    "marketing_opt_out": True,
                }
            ],
        }
    )

    if not template_has_opt_out_footer(next_components):
        next_components.append({"type": "FOOTER", "text": MARKETING_OPT_OUT_FOOTER})
    return next_components


async def apply_marketing_opt_out(
    db: AsyncSession,
    *,
    contact: Contact,
) -> bool:
    if contact.marketing_opt_in is False:
        return False
    contact.marketing_opt_in = False
    await db.flush()
    return True


async def maybe_handle_marketing_opt_out(
    db: AsyncSession,
    *,
    whatsapp_account,
    contact: Contact,
    conversation,
    text_body: str | None,
    interactive_reply: dict | None,
) -> bool:
    if not is_marketing_opt_out_request(
        text=text_body,
        button_id=(interactive_reply or {}).get("button_id"),
        button_title=(interactive_reply or {}).get("button_title"),
    ):
        return False

    changed = await apply_marketing_opt_out(db, contact=contact)
    if not changed:
        return True

    try:
        from app.schemas.whatsapp import SendTextMessageRequest
        from app.services.whatsapp import send_text_message

        await send_text_message(
            db,
            account_id=whatsapp_account.account_id,
            whatsapp_account_id=whatsapp_account.id,
            payload=SendTextMessageRequest(
                to=contact.external_address,
                text="تم إيقاف الرسائل التسويقية. لن تصلك حملات ترويجية بعد الآن.",
            ),
            record_mac=False,
        )
    except Exception:
        pass

    try:
        from app.realtime.event_bus import publish_event

        await publish_event(
            whatsapp_account.account_id,
            {
                "type": "contact.marketing_opt_out",
                "contact_id": str(contact.id),
                "conversation_id": str(conversation.id),
            },
        )
    except Exception:
        pass

    return True
