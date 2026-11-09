"""Guards against duplicate campaign sends on follow-up / failed retry."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.message import Message, MessageDirection, MessageStatus
from app.services.campaign_failure_reasons import (
    CampaignFailureReason,
    classify_campaign_failure,
)
from app.services.phone_normalize import normalize_whatsapp_phone

UNCERTAIN_DELIVERY_MARKERS = (
    "delivery state unknown",
    "reconcile before retry",
    "worker interruption",
)

COUNTRY_DIAL = {"KW": "965", "SA": "966", "AE": "971", "QA": "974", "BH": "973", "OM": "968"}

# Permanent / do-not-blindly-retry reasons for follow-up & retry defaults
NON_RETRYABLE_REASONS = {
    CampaignFailureReason.UNREACHABLE,
    CampaignFailureReason.INVALID_PHONE,
    CampaignFailureReason.OPT_OUT,
}


def is_uncertain_delivery_failure(error_message: str | None) -> bool:
    text = (error_message or "").strip().lower()
    return any(marker in text for marker in UNCERTAIN_DELIVERY_MARKERS)


def is_safe_to_resend_failure(error_message: str | None) -> bool:
    """True only when failure looks real and retryable (not uncertain / permanent)."""
    if is_uncertain_delivery_failure(error_message):
        return False
    reason = classify_campaign_failure(error_message)
    if reason in NON_RETRYABLE_REASONS:
        return False
    return True


def normalize_contact_phone(external_address: str | None, country_code: str | None) -> str | None:
    dial = COUNTRY_DIAL.get((country_code or "KW").upper(), "965")
    return normalize_whatsapp_phone(external_address or "", country_code=dial)


async def find_confirmed_outbound_for_campaign_contact(
    db: AsyncSession,
    *,
    campaign_id: UUID,
    contact_id: UUID,
) -> Message | None:
    """Find an already-accepted outbound campaign message for this contact."""
    rows = (
        await db.execute(
            select(Message)
            .where(
                Message.contact_id == contact_id,
                Message.direction == MessageDirection.OUTBOUND,
                Message.external_message_id.is_not(None),
            )
            .order_by(Message.created_at.desc())
            .limit(40)
        )
    ).scalars().all()
    campaign_key = str(campaign_id)
    for message in rows:
        payload = message.provider_payload if isinstance(message.provider_payload, dict) else {}
        if payload.get("campaign_id") == campaign_key:
            return message
    return None


async def reconcile_uncertain_failed_recipient(
    db: AsyncSession,
    *,
    campaign_id: UUID,
    recipient: CampaignRecipient,
) -> CampaignRecipientStatus | None:
    """
    If Meta already accepted a send, restore recipient status instead of resending.
    Returns the restored status, or None if still unknown/safe to treat as failed.
    """
    if recipient.status != CampaignRecipientStatus.FAILED:
        return None
    if not is_uncertain_delivery_failure(recipient.error_message) and not recipient.external_message_id:
        # Still check inbox for blind retries of uncertain-looking empties
        if recipient.error_message:
            return None

    message = await find_confirmed_outbound_for_campaign_contact(
        db, campaign_id=campaign_id, contact_id=recipient.contact_id
    )
    if message is None:
        return None

    if message.status == MessageStatus.READ:
        restored = CampaignRecipientStatus.READ
    elif message.status == MessageStatus.DELIVERED:
        restored = CampaignRecipientStatus.DELIVERED
    elif message.status == MessageStatus.FAILED:
        return None
    else:
        restored = CampaignRecipientStatus.SENT

    recipient.status = restored
    recipient.external_message_id = message.external_message_id
    recipient.error_message = None
    recipient.sending_started_at = None
    return restored
