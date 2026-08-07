"""MAC (Monthly Active Contact) tracking service.

Billing policy:
- One MAC per unique contact per channel per calendar month (YYYY-MM cycle).
- Count when customer sends inbound message OR staff/AI sends from Inbox.
- Campaign bulk sends increment campaign message counters only - never MAC.
"""
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.models.monthly_active_contact import MacTriggerSource, MonthlyActiveContact
from app.models.whatsapp_account import WhatsAppAccount


def current_cycle_month(when: datetime | None = None) -> str:
    """Return billing cycle key as YYYY-MM (UTC calendar month)."""
    dt = when or datetime.now(UTC)
    return dt.strftime("%Y-%m")


async def record_mac(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    contact_id: UUID,
    trigger_source: MacTriggerSource,
    activity_at: datetime | None = None,
) -> bool:
    """Record MAC if not already counted this cycle. Returns True when newly created."""
    if contact_id is None:
        return False
    at = activity_at or datetime.now(UTC)
    cycle = current_cycle_month(at)
    stmt = (
        insert(MonthlyActiveContact)
        .values(
            id=uuid4(),
            account_id=account_id,
            channel_id=channel_id,
            contact_id=contact_id,
            cycle_month=cycle,
            trigger_source=trigger_source.value,
            first_activity_at=at,
        )
        .on_conflict_do_nothing(
            constraint="uq_mac_account_channel_contact_cycle",
        )
    )
    result = await db.execute(stmt)
    return result.rowcount > 0


async def count_mac_for_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    cycle_month: str | None = None,
) -> int:
    cycle = cycle_month or current_cycle_month()
    return int(
        (
            await db.scalar(
                select(func.count(MonthlyActiveContact.id)).where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.channel_id == channel_id,
                    MonthlyActiveContact.cycle_month == cycle,
                )
            )
        )
        or 0
    )


async def count_mac_for_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> int:
    cycle = cycle_month or current_cycle_month()
    return int(
        (
            await db.scalar(
                select(func.count(MonthlyActiveContact.id)).where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.cycle_month == cycle,
                )
            )
        )
        or 0
    )


async def list_mac_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID | None = None,
    cycle_month: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    cycle = cycle_month or current_cycle_month()
    query = (
        select(MonthlyActiveContact, Contact)
        .join(Contact, Contact.id == MonthlyActiveContact.contact_id)
        .where(
            MonthlyActiveContact.account_id == account_id,
            MonthlyActiveContact.cycle_month == cycle,
            Contact.deleted_at.is_(None),
        )
        .order_by(MonthlyActiveContact.first_activity_at.desc())
        .limit(min(max(limit, 1), 500))
        .offset(max(offset, 0))
    )
    if channel_id is not None:
        query = query.where(MonthlyActiveContact.channel_id == channel_id)

    rows = list((await db.execute(query)).all())
    return [
        {
            "id": mac.id,
            "channel_id": mac.channel_id,
            "contact_id": mac.contact_id,
            "contact_display_name": contact.display_name,
            "contact_phone": contact.external_address,
            "cycle_month": mac.cycle_month,
            "trigger_source": mac.trigger_source,
            "first_activity_at": mac.first_activity_at,
        }
        for mac, contact in rows
    ]


async def count_campaign_messages_for_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    cycle_month: str | None = None,
) -> int:
    """Count successful campaign sends in cycle - billed by message, not MAC."""
    cycle = cycle_month or current_cycle_month()
    year, month = map(int, cycle.split("-"))
    start = datetime(year, month, 1, tzinfo=UTC)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, month + 1, 1, tzinfo=UTC)

    wa_ids = list(
        (
            await db.execute(
                select(WhatsAppAccount.id).where(
                    WhatsAppAccount.account_id == account_id,
                    WhatsAppAccount.channel_id == channel_id,
                )
            )
        ).scalars().all()
    )
    if not wa_ids:
        return 0

    return int(
        (
            await db.scalar(
                select(func.count(CampaignRecipient.id))
                .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
                .where(
                    Campaign.account_id == account_id,
                    Campaign.whatsapp_account_id.in_(wa_ids),
                    CampaignRecipient.status.in_(
                        [
                            CampaignRecipientStatus.SENT,
                            CampaignRecipientStatus.DELIVERED,
                            CampaignRecipientStatus.READ,
                        ]
                    ),
                    CampaignRecipient.updated_at >= start,
                    CampaignRecipient.updated_at < end,
                )
            )
        )
        or 0
    )