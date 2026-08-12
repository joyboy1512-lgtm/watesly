"""Contact reachability scoring for campaign audience quality."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.services.phone_normalize import normalize_whatsapp_phone

COUNTRY_DIAL = {"KW": "965", "SA": "966", "AE": "971", "BH": "973", "OM": "968", "QA": "974"}


class ReachabilityStatus(StrEnum):
    REACHABLE = "reachable"
    RISKY = "risky"
    UNREACHABLE = "unreachable"


_UNREACHABLE_PATTERNS = (
    "healthy ecosystem engagement",
    "not on whatsapp",
    "no longer on whatsapp",
    "invalid phone",
    "131026",
    "131049",
    "recipient not valid",
    "undeliverable",
    "message undeliverable",
)

_RISKY_PATTERNS = (
    "rate limit",
    "temporarily",
    "131000",
)


def classify_delivery_error(error_message: str | None) -> ReachabilityStatus:
    normalized = (error_message or "").strip().lower()
    if not normalized:
        return ReachabilityStatus.RISKY
    if any(pattern in normalized for pattern in _UNREACHABLE_PATTERNS):
        return ReachabilityStatus.UNREACHABLE
    if any(pattern in normalized for pattern in _RISKY_PATTERNS):
        return ReachabilityStatus.RISKY
    return ReachabilityStatus.RISKY


def is_phone_valid_for_whatsapp(contact: Contact) -> bool:
    dial = COUNTRY_DIAL.get((contact.country_code or "KW").upper(), "965")
    return bool(normalize_whatsapp_phone(contact.external_address, country_code=dial))


def is_contact_campaign_eligible(
    contact: Contact,
    *,
    exclude_unreachable: bool = True,
    exclude_risky: bool = False,
    require_marketing_opt_in: bool = True,
) -> bool:
    if require_marketing_opt_in and contact.marketing_opt_in is False:
        return False
    if not is_phone_valid_for_whatsapp(contact):
        return False
    status = contact.reachability_status
    if exclude_unreachable and status == ReachabilityStatus.UNREACHABLE:
        return False
    if exclude_risky and status == ReachabilityStatus.RISKY:
        return False
    if exclude_risky and contact.last_inbound_at is None and status != ReachabilityStatus.REACHABLE:
        return False
    return True


async def record_delivery_failure(
    db: AsyncSession,
    *,
    contact: Contact,
    error_message: str | None,
) -> None:
    contact.delivery_failure_count = int(contact.delivery_failure_count or 0) + 1
    contact.last_delivery_failure_at = datetime.now(UTC)
    if error_message:
        contact.reachability_reason = str(error_message)[:500]
    classified = classify_delivery_error(error_message)
    if classified == ReachabilityStatus.UNREACHABLE or contact.delivery_failure_count >= 2:
        contact.reachability_status = ReachabilityStatus.UNREACHABLE
    else:
        contact.reachability_status = ReachabilityStatus.RISKY


async def record_delivery_success(db: AsyncSession, *, contact: Contact) -> None:
    contact.reachability_status = ReachabilityStatus.REACHABLE
    contact.reachability_reason = None
    contact.delivery_failure_count = 0
    contact.last_delivery_failure_at = None


async def record_inbound_activity(db: AsyncSession, *, contact: Contact) -> None:
    contact.reachability_status = ReachabilityStatus.REACHABLE
    contact.reachability_reason = None
    contact.last_inbound_at = datetime.now(UTC)


async def summarize_reachability(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
    last_inbound: dict[UUID, datetime] | None = None,
) -> dict:
    if not contact_ids:
        return {
            "reachable": 0,
            "risky": 0,
            "unreachable": 0,
            "invalid_phone": 0,
            "cold_audience": 0,
            "warm_audience": 0,
        }

    result = await db.execute(
        select(Contact).where(
            Contact.account_id == account_id,
            Contact.id.in_(contact_ids),
            Contact.deleted_at.is_(None),
        )
    )
    contacts = list(result.scalars().all())
    last_inbound = last_inbound or {}

    reachable = risky = unreachable = invalid_phone = cold_audience = warm_audience = 0
    for contact in contacts:
        if not is_phone_valid_for_whatsapp(contact):
            invalid_phone += 1
            continue

        status = contact.reachability_status
        inbound_at = last_inbound.get(contact.id) or contact.last_inbound_at
        if inbound_at is None:
            cold_audience += 1
        else:
            warm_audience += 1

        if status == ReachabilityStatus.UNREACHABLE:
            unreachable += 1
        elif status == ReachabilityStatus.RISKY or inbound_at is None:
            risky += 1
        else:
            reachable += 1

    return {
        "reachable": reachable,
        "risky": risky,
        "unreachable": unreachable,
        "invalid_phone": invalid_phone,
        "cold_audience": cold_audience,
        "warm_audience": warm_audience,
    }


async def count_campaign_eligible(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
    exclude_unreachable: bool = True,
    exclude_risky: bool = False,
) -> int:
    if not contact_ids:
        return 0
    result = await db.execute(
        select(Contact).where(
            Contact.account_id == account_id,
            Contact.id.in_(contact_ids),
            Contact.deleted_at.is_(None),
            Contact.marketing_opt_in.is_(True),
        )
    )
    contacts = list(result.scalars().all())
    return sum(
        1
        for contact in contacts
        if is_contact_campaign_eligible(
            contact,
            exclude_unreachable=exclude_unreachable,
            exclude_risky=exclude_risky,
        )
    )


async def backfill_unreachable_from_campaign_failures(db: AsyncSession) -> int:
    from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus

    rows = (
        await db.execute(
            select(CampaignRecipient.contact_id, CampaignRecipient.error_message, CampaignRecipient.updated_at)
            .where(
                CampaignRecipient.status == CampaignRecipientStatus.FAILED,
                CampaignRecipient.error_message.is_not(None),
            )
            .order_by(CampaignRecipient.updated_at.desc())
        )
    ).all()
    updated = 0
    seen: set[UUID] = set()
    for contact_id, error_message, updated_at in rows:
        if contact_id in seen:
            continue
        seen.add(contact_id)
        contact = await db.get(Contact, contact_id)
        if contact is None or contact.deleted_at is not None:
            continue
        if contact.reachability_status == ReachabilityStatus.UNREACHABLE:
            continue
        classified = classify_delivery_error(error_message)
        if classified != ReachabilityStatus.UNREACHABLE:
            continue
        contact.reachability_status = ReachabilityStatus.UNREACHABLE
        contact.reachability_reason = str(error_message)[:500]
        contact.delivery_failure_count = max(int(contact.delivery_failure_count or 0), 1)
        contact.last_delivery_failure_at = updated_at
        updated += 1
    if updated:
        await db.commit()
    return updated
