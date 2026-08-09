"""MAC (Monthly Active Contact) tracking service.

Billing policy:
- One MAC per unique contact per account per calendar month (YYYY-MM cycle).
- Count when customer sends inbound OR staff/AI sends from Inbox/conversation.
- Campaign bulk sends increment campaign message counters only - never MAC.
- Same contact on multiple channels in one month still counts as one MAC.
"""
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.channel import Channel
from app.models.contact import Contact
from app.models.monthly_active_contact import MacTriggerSource, MonthlyActiveContact
from app.models.whatsapp_account import WhatsAppAccount


def current_cycle_month(when: datetime | None = None) -> str:
    """Return billing cycle key as YYYY-MM (UTC calendar month)."""
    dt = when or datetime.now(UTC)
    return dt.strftime("%Y-%m")


def compute_mac_balance(*, mac_count: int, included_mac: int) -> dict[str, int | bool]:
    remaining = max(0, included_mac - mac_count)
    over_count = max(0, mac_count - included_mac)
    return {
        "mac_remaining": remaining,
        "is_over_mac": mac_count > included_mac,
        "over_mac_count": over_count,
        "over_mac_blocks": (over_count + 99) // 100,
    }


def estimate_over_mac_charge(*, over_mac_count: int, price_per_100: float) -> float:
    blocks = (over_mac_count + 99) // 100
    return round(blocks * price_per_100, 3)


async def get_account_mac_summary(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> dict:
    from app.services.billing import get_active_subscription

    cycle = cycle_month or current_cycle_month()
    included_mac = 1000
    over_mac_price_per_100 = 12.0
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is not None:
        _, plan = subscription_data
        included_mac = plan.included_mac
        over_mac_price_per_100 = float(plan.over_mac_price_per_100)

    mac_count = await count_mac_for_account(db, account_id=account_id, cycle_month=cycle)
    balance = compute_mac_balance(mac_count=mac_count, included_mac=included_mac)
    over_mac_count = int(balance["over_mac_count"])
    return {
        "cycle_month": cycle,
        "mac_count": mac_count,
        "included_mac": included_mac,
        "over_mac_price_per_100": over_mac_price_per_100,
        **balance,
        "estimated_over_mac_charge": estimate_over_mac_charge(
            over_mac_count=over_mac_count,
            price_per_100=over_mac_price_per_100,
        ),
    }


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
            constraint="uq_mac_account_contact_cycle",
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
        select(MonthlyActiveContact, Contact, Channel.name)
        .join(Contact, Contact.id == MonthlyActiveContact.contact_id)
        .join(Channel, Channel.id == MonthlyActiveContact.channel_id)
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
            "channel_name": channel_name,
            "contact_id": mac.contact_id,
            "contact_display_name": contact.display_name,
            "contact_phone": contact.external_address,
            "cycle_month": mac.cycle_month,
            "trigger_source": mac.trigger_source,
            "first_activity_at": mac.first_activity_at,
        }
        for mac, contact, channel_name in rows
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


def _cycle_bounds(cycle_month: str) -> tuple[datetime, datetime]:
    year, month = map(int, cycle_month.split("-"))
    start = datetime(year, month, 1, tzinfo=UTC)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, month + 1, 1, tzinfo=UTC)
    return start, end


async def count_campaign_messages_for_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> int:
    cycle = cycle_month or current_cycle_month()
    start, end = _cycle_bounds(cycle)

    wa_ids = list(
        (
            await db.execute(
                select(WhatsAppAccount.id).where(WhatsAppAccount.account_id == account_id)
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


async def get_mac_insights(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> dict:
    cycle = cycle_month or current_cycle_month()
    included_per_channel = 1000
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is not None:
        _, plan = subscription_data
        included_per_channel = plan.included_mac

    from app.services.channels import list_channels

    channel_count = len(await list_channels(db, account_id))

    trigger_rows = list(
        (
            await db.execute(
                select(MonthlyActiveContact.trigger_source, func.count(MonthlyActiveContact.id))
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.cycle_month == cycle,
                )
                .group_by(MonthlyActiveContact.trigger_source)
                .order_by(func.count(MonthlyActiveContact.id).desc())
            )
        ).all()
    )

    day_bucket = func.date_trunc("day", MonthlyActiveContact.first_activity_at)
    daily_rows = list(
        (
            await db.execute(
                select(day_bucket, func.count(MonthlyActiveContact.id))
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.cycle_month == cycle,
                )
                .group_by(day_bucket)
                .order_by(day_bucket.asc())
            )
        ).all()
    )

    campaign_messages = await count_campaign_messages_for_account(
        db, account_id=account_id, cycle_month=cycle
    )

    return {
        "cycle_month": cycle,
        "included_mac_per_channel": included_per_channel,
        "channel_count": channel_count,
        "trigger_breakdown": [
            {"source": str(source), "count": int(count)} for source, count in trigger_rows
        ],
        "daily_trend": [
            {
                "date": day.isoformat()[:10] if hasattr(day, "isoformat") else str(day)[:10],
                "count": int(count),
            }
            for day, count in daily_rows
        ],
        "campaign_messages_sent": campaign_messages,
    }