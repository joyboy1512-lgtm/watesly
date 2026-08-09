"""MAC (Monthly Active Contact) tracking — queries and summaries.

Recording is handled by mac_usage.record_activity (central, idempotent service).
"""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.channel import Channel
from app.models.contact import Contact
from app.models.message import Message, MessageDirection
from app.models.monthly_active_contact import MonthlyActiveContact
from app.models.whatsapp_account import WhatsAppAccount
from app.services.billing_period import cycle_month_key, resolve_billing_period, resolve_channel_billing_period

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


async def _period_for_channel(
    db: AsyncSession,
    *,
    channel_id: UUID,
    cycle_month: str | None = None,
) -> tuple[datetime, datetime] | None:
    if cycle_month:
        year, month = map(int, cycle_month.split("-"))
        start = datetime(year, month, 1, tzinfo=UTC)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=UTC)
        else:
            end = datetime(year, month + 1, 1, tzinfo=UTC)
        return start, end
    return await resolve_channel_billing_period(db, channel_id=channel_id)


async def _channel_period_pairs(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> list[tuple[UUID, datetime, datetime]]:
    from app.services.channels import list_channels

    pairs: list[tuple[UUID, datetime, datetime]] = []
    for channel in await list_channels(db, account_id):
        period = await _period_for_channel(
            db, channel_id=channel.id, cycle_month=cycle_month
        )
        if period is None:
            continue
        period_start, period_end = period
        pairs.append((channel.id, period_start, period_end))
    return pairs


async def get_account_mac_summary(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> dict:
    from app.services.billing import get_active_subscription
    from app.services.billing_limits import (
        compute_channel_over_mac_charge,
        effective_channel_included_mac,
        effective_channel_over_price,
    )
    from app.services.channels import list_channels

    period_start, period_end = await _period_for_account(
        db, account_id=account_id, cycle_month=cycle_month
    )
    mac_limit_policy = "soft"
    overage_enabled = True
    subscription_data = await get_active_subscription(db, account_id)
    subscription = None
    plan = None
    if subscription_data is not None:
        subscription, plan = subscription_data
        mac_limit_policy = getattr(plan, "mac_limit_policy", "soft") or "soft"
        overage_enabled = bool(getattr(plan, "overage_enabled", True))

    channels = await list_channels(db, account_id)
    total_mac = 0
    total_included = 0
    total_over_count = 0
    total_over_blocks = 0
    total_charge = 0.0
    avg_price = 12.0

    for channel in channels:
        period = await _period_for_channel(
            db, channel_id=channel.id, cycle_month=cycle_month
        )
        if period is None:
            continue
        ch_start, _ch_end = period
        channel_mac = await count_mac_for_channel(
            db,
            account_id=account_id,
            channel_id=channel.id,
            period_start=ch_start,
        )
        included = effective_channel_included_mac(
            channel=channel, subscription=subscription, plan=plan
        )
        price = effective_channel_over_price(
            channel=channel, subscription=subscription, plan=plan
        )
        over = compute_channel_over_mac_charge(
            channel_mac=channel_mac,
            included_mac=included,
            price_per_100=price,
            overage_enabled=overage_enabled,
        )
        total_mac += channel_mac
        total_included += included
        total_over_count += int(over["attributed_over_mac_count"])
        total_over_blocks += int(over["over_mac_blocks"])
        total_charge += float(over["estimated_channel_over_mac_charge"])
        avg_price = price

    balance = compute_mac_balance(mac_count=total_mac, included_mac=total_included)
    return {
        "cycle_month": cycle_month_key(period_start),
        "billing_period_start": period_start,
        "billing_period_end": period_end,
        "mac_count": total_mac,
        "included_mac": total_included,
        "mac_limit_policy": mac_limit_policy,
        "overage_enabled": overage_enabled,
        "over_mac_price_per_100": avg_price,
        **balance,
        "over_mac_count": total_over_count,
        "over_mac_blocks": total_over_blocks,
        "estimated_over_mac_charge": round(total_charge, 3) if overage_enabled else 0.0,
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
        period = await _period_for_channel(
            db, channel_id=channel_id, cycle_month=cycle_month
        )
        if period is None:
            return 0
        period_start, _ = period
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
    if period_start is not None:
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

    pairs = await _channel_period_pairs(
        db, account_id=account_id, cycle_month=cycle_month
    )
    if not pairs:
        return 0

    total = 0
    for channel_id, ch_start, _ch_end in pairs:
        total += await count_mac_for_channel(
            db,
            account_id=account_id,
            channel_id=channel_id,
            period_start=ch_start,
        )
    return total


async def list_mac_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID | None = None,
    cycle_month: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    if channel_id is not None:
        period = await _period_for_channel(
            db, channel_id=channel_id, cycle_month=cycle_month
        )
        if period is None:
            return []
        period_start, _ = period
        period_filters = [(channel_id, period_start)]
    else:
        pairs = await _channel_period_pairs(
            db, account_id=account_id, cycle_month=cycle_month
        )
        period_filters = [(cid, pstart) for cid, pstart, _ in pairs]
        if not period_filters:
            return []

    query = (
        select(MonthlyActiveContact, Contact, Channel.name)
        .join(Contact, Contact.id == MonthlyActiveContact.contact_id)
        .join(Channel, Channel.id == MonthlyActiveContact.channel_id)
        .where(
            MonthlyActiveContact.account_id == account_id,
            Contact.deleted_at.is_(None),
            tuple_(
                MonthlyActiveContact.channel_id,
                MonthlyActiveContact.billing_period_start,
            ).in_(period_filters),
        )
        .order_by(MonthlyActiveContact.first_activity_at.desc())
        .limit(min(max(limit, 1), 500))
        .offset(max(offset, 0))
    )

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
        period = await _period_for_channel(
            db, channel_id=channel_id, cycle_month=cycle_month
        )
        if period is None:
            return 0
        period_start, period_end = period

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


async def count_outbound_messages_for_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
    cycle_month: str | None = None,
) -> int:
    if period_start is None or period_end is None:
        period = await _period_for_channel(
            db, channel_id=channel_id, cycle_month=cycle_month
        )
        if period is None:
            return 0
        period_start, period_end = period

    return int(
        (
            await db.scalar(
                select(func.count(Message.id)).where(
                    Message.account_id == account_id,
                    Message.channel_id == channel_id,
                    Message.direction == MessageDirection.OUTBOUND,
                    Message.created_at >= period_start,
                    Message.created_at < period_end,
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
    pairs = await _channel_period_pairs(
        db, account_id=account_id, cycle_month=cycle_month
    )
    total = 0
    for channel_id, period_start, period_end in pairs:
        total += await count_campaign_messages_for_channel(
            db,
            account_id=account_id,
            channel_id=channel_id,
            period_start=period_start,
            period_end=period_end,
        )
    return total


async def get_mac_insights(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> dict:
    from app.services.billing import get_active_subscription
    from app.services.billing_limits import effective_channel_included_mac
    from app.services.channels import list_channels

    period_start, period_end = await _period_for_account(
        db, account_id=account_id, cycle_month=cycle_month
    )
    subscription_data = await get_active_subscription(db, account_id)
    subscription = subscription_data[0] if subscription_data else None
    plan = subscription_data[1] if subscription_data else None

    channels = await list_channels(db, account_id)
    included_mac = 0
    for channel in channels:
        included_mac += effective_channel_included_mac(
            channel=channel, subscription=subscription, plan=plan
        )

    pairs = await _channel_period_pairs(
        db, account_id=account_id, cycle_month=cycle_month
    )
    period_filters = [(cid, pstart) for cid, pstart, _ in pairs]

    if not period_filters:
        return {
            "cycle_month": cycle_month_key(period_start),
            "billing_period_start": period_start,
            "billing_period_end": period_end,
            "included_mac": included_mac,
            "channel_count": len(channels),
            "trigger_breakdown": [],
            "channel_breakdown": [],
            "daily_trend": [],
            "campaign_messages_sent": 0,
        }

    period_clause = tuple_(
        MonthlyActiveContact.channel_id,
        MonthlyActiveContact.billing_period_start,
    ).in_(period_filters)

    trigger_rows = list(
        (
            await db.execute(
                select(MonthlyActiveContact.trigger_source, func.count(MonthlyActiveContact.id))
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    period_clause,
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
                    period_clause,
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
                    period_clause,
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
        "channel_count": len(channels),
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
    """Per-channel MAC drill-down with independent billing period and overage."""
    from app.services.billing import get_active_subscription
    from app.services.channel_billing import channel_billing_payload

    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("CHANNEL_NOT_FOUND")

    subscription_data = await get_active_subscription(db, account_id)
    subscription = subscription_data[0] if subscription_data else None
    plan = subscription_data[1] if subscription_data else None
    plan_name = plan.name if plan else "—"
    overage_enabled = bool(getattr(plan, "overage_enabled", True)) if plan else True
    mac_limit_policy = getattr(plan, "mac_limit_policy", "soft") if plan else "soft"

    billing = await channel_billing_payload(
        db,
        account_id=account_id,
        channel=channel,
        overage_enabled=overage_enabled,
    )
    period_start = billing["billing_period_start"]
    period_end = billing["billing_period_end"]
    channel_mac = int(billing["mac_count"])
    included = int(billing["included_mac"])
    remaining = int(billing["mac_remaining"])

    workspace_summary = await get_account_mac_summary(
        db, account_id=account_id, cycle_month=cycle_month
    )
    workspace_used = int(workspace_summary["mac_count"])
    share = round((channel_mac / workspace_used) * 100, 1) if workspace_used > 0 else 0.0
    usage_percent = round((channel_mac / included) * 100, 1) if included > 0 else (100.0 if channel_mac > 0 else 0.0)

    if period_start is None:
        raise ValueError("NO_BILLING_PERIOD")

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
    over_count = int(billing["attributed_over_mac_count"])
    over_blocks = (over_count + 99) // 100 if over_count > 0 else 0
    over_charge = float(billing["estimated_channel_over_mac_charge"])
    over_price = float(billing["over_mac_price_per_100"])

    return {
        "channel_id": channel_id,
        "channel_name": channel.name,
        "channel_type": channel_type,
        "channel_status": channel_status,
        "cycle_month": str(billing["cycle_month"]),
        "billing_period": {
            "start": period_start,
            "end": period_end,
        },
        "mac": {
            "channel_count": channel_mac,
            "channel_included": included,
            "channel_remaining": remaining,
            "usage_percent": usage_percent,
            "workspace_used": workspace_used,
            "workspace_included": int(workspace_summary["included_mac"]),
            "workspace_remaining": int(workspace_summary["mac_remaining"]),
            "share_percent": share,
        },
        "overage": {
            "enabled": overage_enabled,
            "is_over": bool(billing["is_over_mac"]),
            "count": over_count,
            "blocks": over_blocks,
            "estimated_charge": over_charge,
            "price_per_100": over_price,
        },
        "pricing": {
            "plan_name": plan_name,
            "included_mac": included,
            "over_mac_price_per_100": over_price,
        },
        "policy": {
            "limit_policy": str(mac_limit_policy or "soft"),
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
