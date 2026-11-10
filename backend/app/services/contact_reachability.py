"""Contact reachability scoring for campaign audience quality."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
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
    INVALID = "invalid"


class WhatsAppContactStatus(StrEnum):
    """Operator-facing WhatsApp readiness for a contact."""

    ACCEPTS = "accepts"
    UNREACHABLE = "unreachable"
    INVALID = "invalid"
    DND = "dnd"


WHATSAPP_STATUS_LABELS_AR: dict[str, str] = {
    WhatsAppContactStatus.ACCEPTS: "يقبل الاستلام",
    WhatsAppContactStatus.UNREACHABLE: "غير قابل للوصول",
    WhatsAppContactStatus.INVALID: "غير صالح",
    WhatsAppContactStatus.DND: "طلب عدم الإزعاج",
}


_INVALID_PATTERNS = (
    "invalid phone",
    "invalid phone number",
    "phone number format",
)

_UNREACHABLE_PATTERNS = (
    "healthy ecosystem engagement",
    "not on whatsapp",
    "no longer on whatsapp",
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
    if any(pattern in normalized for pattern in _INVALID_PATTERNS):
        return ReachabilityStatus.INVALID
    if any(pattern in normalized for pattern in _UNREACHABLE_PATTERNS):
        return ReachabilityStatus.UNREACHABLE
    if any(pattern in normalized for pattern in _RISKY_PATTERNS):
        return ReachabilityStatus.RISKY
    return ReachabilityStatus.RISKY


def is_phone_valid_for_whatsapp(contact: Contact) -> bool:
    dial = COUNTRY_DIAL.get((contact.country_code or "KW").upper(), "965")
    return bool(normalize_whatsapp_phone(contact.external_address, country_code=dial))


def resolve_whatsapp_contact_status(contact: Contact) -> WhatsAppContactStatus:
    """Single customer WhatsApp status (priority: DND → invalid → unreachable → accepts)."""
    if contact.marketing_opt_in is False:
        return WhatsAppContactStatus.DND
    if contact.reachability_status == ReachabilityStatus.INVALID or not is_phone_valid_for_whatsapp(contact):
        return WhatsAppContactStatus.INVALID
    if contact.reachability_status == ReachabilityStatus.UNREACHABLE:
        return WhatsAppContactStatus.UNREACHABLE
    return WhatsAppContactStatus.ACCEPTS


def whatsapp_status_label(status: WhatsAppContactStatus | str) -> str:
    key = status.value if isinstance(status, WhatsAppContactStatus) else str(status)
    return WHATSAPP_STATUS_LABELS_AR.get(key, WHATSAPP_STATUS_LABELS_AR[WhatsAppContactStatus.ACCEPTS])


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
    if exclude_unreachable and status in {
        ReachabilityStatus.UNREACHABLE,
        ReachabilityStatus.INVALID,
    }:
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
    if classified == ReachabilityStatus.INVALID:
        contact.reachability_status = ReachabilityStatus.INVALID
    elif classified == ReachabilityStatus.UNREACHABLE or contact.delivery_failure_count >= 2:
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


async def get_previously_sent_contact_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
) -> set[UUID]:
    """Contacts we already messaged (outbound inbox or prior campaign send)."""
    if not contact_ids:
        return set()

    from app.models.campaign import Campaign
    from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
    from app.models.message import Message, MessageDirection

    sent_statuses = {
        CampaignRecipientStatus.QUEUED,
        CampaignRecipientStatus.SENDING,
        CampaignRecipientStatus.SENT,
        CampaignRecipientStatus.DELIVERED,
        CampaignRecipientStatus.READ,
    }

    outbound_rows = await db.execute(
        select(Message.contact_id)
        .where(
            Message.account_id == account_id,
            Message.contact_id.in_(contact_ids),
            Message.direction == MessageDirection.OUTBOUND,
        )
        .distinct()
    )
    previously = {row[0] for row in outbound_rows.all() if row[0] is not None}

    campaign_rows = await db.execute(
        select(CampaignRecipient.contact_id)
        .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
        .where(
            Campaign.account_id == account_id,
            CampaignRecipient.contact_id.in_(contact_ids),
            CampaignRecipient.status.in_(sent_statuses),
        )
        .distinct()
    )
    previously.update(row[0] for row in campaign_rows.all() if row[0] is not None)
    return previously


async def filter_never_sent_contact_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
) -> list[UUID]:
    previously = await get_previously_sent_contact_ids(
        db, account_id=account_id, contact_ids=contact_ids
    )
    return [contact_id for contact_id in contact_ids if contact_id not in previously]


_CAMPAIGN_SENT_STATUSES = None


def _campaign_sent_statuses():
    global _CAMPAIGN_SENT_STATUSES
    if _CAMPAIGN_SENT_STATUSES is None:
        from app.models.campaign_recipient import CampaignRecipientStatus

        _CAMPAIGN_SENT_STATUSES = {
            CampaignRecipientStatus.QUEUED,
            CampaignRecipientStatus.SENDING,
            CampaignRecipientStatus.SENT,
            CampaignRecipientStatus.DELIVERED,
            CampaignRecipientStatus.READ,
        }
    return _CAMPAIGN_SENT_STATUSES


def _normalize_period_bounds(
    sent_from: datetime | None,
    sent_to: datetime | None,
) -> tuple[datetime | None, datetime | None]:
    """Inclusive calendar-day bounds in UTC when dates arrive without timezone."""
    start = sent_from
    end = sent_to
    if start is not None and start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    if end is not None and end.tzinfo is None:
        end = end.replace(tzinfo=UTC)
    if end is not None and end.hour == 0 and end.minute == 0 and end.second == 0 and end.microsecond == 0:
        end = end + timedelta(days=1) - timedelta(microseconds=1)
    return start, end


async def get_campaign_sent_contact_ids_in_period(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
    sent_from: datetime | None = None,
    sent_to: datetime | None = None,
    campaign_ids: list[UUID] | None = None,
) -> set[UUID]:
    """Contacts who received a campaign send within an optional date/campaign filter."""
    if not contact_ids:
        return set()
    if sent_from is None and sent_to is None and not campaign_ids:
        return set()

    from app.models.campaign import Campaign
    from app.models.campaign_recipient import CampaignRecipient
    from sqlalchemy import func

    start, end = _normalize_period_bounds(sent_from, sent_to)
    sent_at = func.coalesce(
        CampaignRecipient.sending_started_at,
        Campaign.started_at,
        CampaignRecipient.updated_at,
        CampaignRecipient.created_at,
    )
    conditions = [
        Campaign.account_id == account_id,
        CampaignRecipient.contact_id.in_(contact_ids),
        CampaignRecipient.status.in_(_campaign_sent_statuses()),
    ]
    if campaign_ids:
        conditions.append(CampaignRecipient.campaign_id.in_(campaign_ids))
    if start is not None:
        conditions.append(sent_at >= start)
    if end is not None:
        conditions.append(sent_at <= end)

    rows = await db.execute(
        select(CampaignRecipient.contact_id)
        .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
        .where(*conditions)
        .distinct()
    )
    return {row[0] for row in rows.all() if row[0] is not None}


async def filter_exclude_campaign_sent_in_period(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
    sent_from: datetime | None = None,
    sent_to: datetime | None = None,
    campaign_ids: list[UUID] | None = None,
) -> list[UUID]:
    excluded = await get_campaign_sent_contact_ids_in_period(
        db,
        account_id=account_id,
        contact_ids=contact_ids,
        sent_from=sent_from,
        sent_to=sent_to,
        campaign_ids=campaign_ids,
    )
    return [contact_id for contact_id in contact_ids if contact_id not in excluded]


async def list_campaigns_in_period(
    db: AsyncSession,
    *,
    account_id: UUID,
    sent_from: datetime | None = None,
    sent_to: datetime | None = None,
    contact_ids: list[UUID] | None = None,
) -> list[dict]:
    """Campaign groups that had sends in the period (for UI filters)."""
    from app.models.campaign import Campaign
    from app.models.campaign_recipient import CampaignRecipient
    from sqlalchemy import func

    start, end = _normalize_period_bounds(sent_from, sent_to)
    sent_at = func.coalesce(
        CampaignRecipient.sending_started_at,
        Campaign.started_at,
        CampaignRecipient.updated_at,
        CampaignRecipient.created_at,
    )
    conditions = [
        Campaign.account_id == account_id,
        CampaignRecipient.status.in_(_campaign_sent_statuses()),
        Campaign.archived_at.is_(None),
    ]
    if contact_ids:
        conditions.append(CampaignRecipient.contact_id.in_(contact_ids))
    if start is not None:
        conditions.append(sent_at >= start)
    if end is not None:
        conditions.append(sent_at <= end)

    rows = await db.execute(
        select(
            Campaign.id,
            Campaign.name,
            Campaign.started_at,
            Campaign.completed_at,
            Campaign.status,
            func.count(CampaignRecipient.id),
            func.min(sent_at),
            func.max(sent_at),
        )
        .join(CampaignRecipient, CampaignRecipient.campaign_id == Campaign.id)
        .where(*conditions)
        .group_by(
            Campaign.id,
            Campaign.name,
            Campaign.started_at,
            Campaign.completed_at,
            Campaign.status,
        )
        .order_by(func.max(sent_at).desc())
        .limit(100)
    )
    items: list[dict] = []
    for row in rows.all():
        items.append(
            {
                "id": str(row[0]),
                "name": row[1],
                "started_at": row[2].isoformat() if row[2] else None,
                "completed_at": row[3].isoformat() if row[3] else None,
                "status": row[4].value if hasattr(row[4], "value") else str(row[4]),
                "sent_count": int(row[5] or 0),
                "first_sent_at": row[6].isoformat() if row[6] else None,
                "last_sent_at": row[7].isoformat() if row[7] else None,
            }
        )
    return items


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
