"""MAC (Monthly Active Contact) tracking — queries and summaries.

Recording is handled by mac_usage.record_activity (central, idempotent service).
"""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.channel import Channel
from app.models.contact import Contact
from app.models.monthly_active_contact import MonthlyActiveContact
from app.models.whatsapp_account import WhatsAppAccount
from app.services.billing_period import cycle_month_key, resolve_billing_period

# Re-export for backward compatibility
from app.services.mac_usage import MacActivityType, record_activity, record_mac  # noqa: F401


def current_cycle_month(when: datetime | None = None) -> str:
    """Legacy helper — prefer billing period from subscription."""
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
    if over_mac_count <= 0:
        return 0.0
    blocks = (over_mac_count + 99) // 100
    return round(blocks * price_per_100, 3)


async def _period_for_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> tuple[datetime, datetime]:
    if cycle_month:
        year, month = map(int, cycle_month.split("-"))
        start = datetime(year, month, 1, tzinfo=UTC)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=UTC)
        else:
            end = datetime(year, month + 1, 1, tzinfo=UTC)
        return start, end
    period = await resolve_billing_period(db, account_id=account_id)
    if period is None:
        now = datetime.now(UTC)
        start = datetime(now.year, now.month, 1, tzinfo=UTC)
        if now.month == 12:
            end = datetime(now.year + 1, 1, 1, tzinfo=UTC)
        else:
            end = datetime(now.year, now.month + 1, 1, tzinfo=UTC)
        return start, end
    return period


async def get_account_mac_summary(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> dict:
    from app.services.billing import get_active_subscription

    period_start, period_end = await _period_for_account(
        db, account_id=account_id, cycle_month=cycle_month
    )
    included_mac = 1000
    over_mac_price_per_100 = 12.0
    mac_limit_policy = "soft"
    overage_enabled = True
    subscription_data = await get_active_subscription(db, account_id)
    subscription = None
    plan = None
    if subscription_data is not None:
        subscription, plan = subscription_data
        from app.services.billing_limits import effective_included_mac, effective_workspace_over_price

        included_mac = effective_included_mac(subscription=subscription, plan=plan)
        over_mac_price_per_100 = effective_workspace_over_price(
            subscription=subscription, plan=plan
        )
        mac_limit_policy = getattr(plan, "mac_limit_policy", "soft") or "soft"
        overage_enabled = bool(getattr(plan, "overage_enabled", True))

    mac_count = await count_mac_for_account(
        db,
        account_id=account_id,
        period_start=period_start,
    )
    balance = compute_mac_balance(mac_count=mac_count, included_mac=included_mac)
    over_mac_count = int(balance["over_mac_count"])
    return {
        "cycle_month": cycle_month_key(period_start),
        "billing_period_start": period_start,
        "billing_period_end": period_end,
        "mac_count": mac_count,
        "included_mac": included_mac,
        "mac_limit_policy": mac_limit_policy,
        "overage_enabled": overage_enabled,
        "over_mac_price_per_100": over_mac_price_per_100,
        **balance,
        "estimated_over_mac_charge": estimate_over_mac_charge(
            over_mac_count=over_mac_count,
            price_per_100=over_mac_price_per_100,
        )
        if overage_enabled
        else 0.0,
        "subscription_starts_at": subscription.starts_at if subscription else None,
        "subscription_ends_at": subscription.ends_at if subscription else None,
    }


async def count_mac_for_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    cycle_month: str | None = None,
    period_start: datetime | None = None,
) -> int:
    if period_start is None:
        period_start, _ = await _period_for_account(db, account_id=account_id, cycle_month=cycle_month)
    return int(
        (
            await db.scalar(
                select(func.count(MonthlyActiveContact.id)).where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.channel_id == channel_id,
                    MonthlyActiveContact.billing_period_start == period_start,
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
    period_start: datetime | None = None,
) -> int:
    if period_start is None:
        period_start, _ = await _period_for_account(db, account_id=account_id, cycle_month=cycle_month)
    return int(
        (
            await db.scalar(
                select(func.count(MonthlyActiveContact.id)).where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.billing_period_start == period_start,
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
    period_start, _ = await _period_for_account(db, account_id=account_id, cycle_month=cycle_month)
    query = (
        select(MonthlyActiveContact, Contact, Channel.name)
        .join(Contact, Contact.id == MonthlyActiveContact.contact_id)
        .join(Channel, Channel.id == MonthlyActiveContact.channel_id)
        .where(
            MonthlyActiveContact.account_id == account_id,
            MonthlyActiveContact.billing_period_start == period_start,
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
            "last_active_at": mac.last_active_at,
        }
        for mac, contact, channel_name in rows
    ]


async def count_campaign_messages_for_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
    cycle_month: str | None = None,
) -> int:
    if period_start is None or period_end is None:
        period_start, period_end = await _period_for_account(
            db, account_id=account_id, cycle_month=cycle_month
        )

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
                    CampaignRecipient.updated_at >= period_start,
                    CampaignRecipient.updated_at < period_end,
                )
            )
        )
        or 0
    )


async def count_campaign_messages_for_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> int:
    period_start, period_end = await _period_for_account(
        db, account_id=account_id, cycle_month=cycle_month
    )
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
                    CampaignRecipient.updated_at >= period_start,
                    CampaignRecipient.updated_at < period_end,
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
    from app.services.billing import get_active_subscription
    from app.services.channels import list_channels

    period_start, period_end = await _period_for_account(
        db, account_id=account_id, cycle_month=cycle_month
    )
    included_mac = 1000
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is not None:
        _, plan = subscription_data
        included_mac = plan.included_mac

    channel_count = len(await list_channels(db, account_id))

    trigger_rows = list(
        (
            await db.execute(
                select(MonthlyActiveContact.trigger_source, func.count(MonthlyActiveContact.id))
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.billing_period_start == period_start,
                )
                .group_by(MonthlyActiveContact.trigger_source)
                .order_by(func.count(MonthlyActiveContact.id).desc())
            )
        ).all()
    )

    channel_rows = list(
        (
            await db.execute(
                select(Channel.name, Channel.type, func.count(MonthlyActiveContact.id))
                .join(Channel, Channel.id == MonthlyActiveContact.channel_id)
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.billing_period_start == period_start,
                )
                .group_by(Channel.name, Channel.type)
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
                    MonthlyActiveContact.billing_period_start == period_start,
                )
                .group_by(day_bucket)
                .order_by(day_bucket.asc())
            )
        ).all()
    )

    campaign_messages = await count_campaign_messages_for_account(
        db, account_id=account_id, cycle_month=cycle_month
    )

    return {
        "cycle_month": cycle_month_key(period_start),
        "billing_period_start": period_start,
        "billing_period_end": period_end,
        "included_mac": included_mac,
        "channel_count": channel_count,
        "trigger_breakdown": [
            {"source": str(source), "count": int(count)} for source, count in trigger_rows
        ],
        "channel_breakdown": [
            {"channel_name": name, "channel_type": str(ctype), "count": int(count)}
            for name, ctype, count in channel_rows
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


async def get_billing_usage(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> dict:
    """Unified usage payload for GET /billing/usage."""
    summary = await get_account_mac_summary(db, account_id=account_id)
    insights = await get_mac_insights(db, account_id=account_id)
    used = int(summary["mac_count"])
    included = int(summary["included_mac"])
    percentage = round((used / included) * 100, 1) if included > 0 else (100.0 if used > 0 else 0.0)
    return {
        "billing_period": {
            "start": summary["billing_period_start"],
            "end": summary["billing_period_end"],
        },
        "mac": {
            "used": used,
            "included": included,
            "remaining": int(summary["mac_remaining"]),
            "percentage": percentage,
        },
        "overage": {
            "enabled": bool(summary.get("overage_enabled", True)),
            "is_over": bool(summary["is_over_mac"]),
            "count": int(summary["over_mac_count"]),
            "blocks": int(summary["over_mac_blocks"]),
            "estimated_charge": float(summary["estimated_over_mac_charge"]),
            "price_per_100": float(summary["over_mac_price_per_100"]),
        },
        "policy": {
            "limit_policy": str(summary.get("mac_limit_policy", "soft")),
        },
        "breakdown_by_channel": insights["channel_breakdown"],
        "breakdown_by_activity": insights["trigger_breakdown"],
        "daily_trend": insights["daily_trend"],
        "campaign_messages_sent": insights["campaign_messages_sent"],
    }


async def get_channel_mac_usage(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    cycle_month: str | None = None,
) -> dict:
    """Per-channel MAC drill-down: assigned contacts, trends, workspace overage context."""
    from app.services.billing import get_active_subscription

    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("CHANNEL_NOT_FOUND")

    summary = await get_account_mac_summary(db, account_id=account_id, cycle_month=cycle_month)
    period_start = summary["billing_period_start"]
    period_end = summary["billing_period_end"]

    subscription_data = await get_active_subscription(db, account_id)
    plan_name = "—"
    if subscription_data is not None:
        _, plan = subscription_data
        plan_name = plan.name

    channel_mac = await count_mac_for_channel(
        db, account_id=account_id, channel_id=channel_id, period_start=period_start
    )
    workspace_used = int(summary["mac_count"])
    workspace_included = int(summary["included_mac"])
    share = round((channel_mac / workspace_used) * 100, 1) if workspace_used > 0 else 0.0

    trigger_rows = list(
        (
            await db.execute(
                select(MonthlyActiveContact.trigger_source, func.count(MonthlyActiveContact.id))
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.channel_id == channel_id,
                    MonthlyActiveContact.billing_period_start == period_start,
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
                    MonthlyActiveContact.channel_id == channel_id,
                    MonthlyActiveContact.billing_period_start == period_start,
                )
                .group_by(day_bucket)
                .order_by(day_bucket.asc())
            )
        ).all()
    )

    campaign_messages = await count_campaign_messages_for_channel(
        db,
        account_id=account_id,
        channel_id=channel_id,
        period_start=period_start,
        period_end=period_end,
    )

    channel_status = (
        channel.status.value if hasattr(channel.status, "value") else str(channel.status)
    )
    channel_type = channel.type.value if hasattr(channel.type, "value") else str(channel.type)

    return {
        "channel_id": channel_id,
        "channel_name": channel.name,
        "channel_type": channel_type,
        "channel_status": channel_status,
        "cycle_month": str(summary["cycle_month"]),
        "billing_period": {
            "start": period_start,
            "end": period_end,
        },
        "mac": {
            "channel_count": channel_mac,
            "workspace_used": workspace_used,
            "workspace_included": workspace_included,
            "workspace_remaining": int(summary["mac_remaining"]),
            "share_percent": share,
        },
        "overage": {
            "enabled": bool(summary.get("overage_enabled", True)),
            "is_over": bool(summary["is_over_mac"]),
            "count": int(summary["over_mac_count"]),
            "blocks": int(summary["over_mac_blocks"]),
            "estimated_charge": float(summary["estimated_over_mac_charge"]),
            "price_per_100": float(summary["over_mac_price_per_100"]),
        },
        "pricing": {
            "plan_name": plan_name,
            "included_mac": workspace_included,
            "over_mac_price_per_100": float(summary["over_mac_price_per_100"]),
        },
        "policy": {
            "limit_policy": str(summary.get("mac_limit_policy", "soft")),
        },
        "breakdown_by_activity": [
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
