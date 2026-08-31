from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel, ChannelStatus
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus
from app.schemas.channel import ChannelCreateRequest
from app.schemas.mac import ChannelUsageBoardItem, ChannelUsageBoardResponse
from app.services.billing import get_active_subscription
from app.services.billing_limits import effective_included_mac
from app.services.channel_billing import channel_billing_payload
from app.services.mac_tracking import (
    count_campaign_messages_for_channel,
    get_account_mac_summary,
)
from app.services.membership_access import ensure_membership_channel_access
from app.services.organizations import count_organization_channels
from app.services.plan_limits import is_unlimited, limit_reached


def _enum_str(value) -> str | None:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


async def list_channels(db: AsyncSession, account_id: UUID) -> list[Channel]:
    result = await db.execute(
        select(Channel)
        .where(Channel.account_id == account_id, Channel.deleted_at.is_(None))
        .order_by(Channel.created_at.asc())
    )
    return list(result.scalars().all())


async def create_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: ChannelCreateRequest,
) -> Channel:
    organization = await db.get(Organization, payload.organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")

    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is None:
        raise ValueError("NO_ACTIVE_SUBSCRIPTION")
    subscription, plan = subscription_data

    if not is_unlimited(plan.max_channels):
        account_channel_count = await db.scalar(
            select(func.count(Channel.id)).where(
                Channel.account_id == account_id,
                Channel.deleted_at.is_(None),
            )
        )
        if limit_reached(current_count=account_channel_count or 0, max_limit=plan.max_channels):
            raise ValueError("CHANNEL_LIMIT_REACHED")

    if not is_unlimited(organization.max_channels):
        org_channel_count = await count_organization_channels(db, organization.id)
        if limit_reached(current_count=org_channel_count, max_limit=organization.max_channels):
            raise ValueError("ORG_CHANNEL_LIMIT_REACHED")

    included = effective_included_mac(subscription=subscription, plan=plan)
    billing_cycle = (
        subscription.billing_cycle.value
        if hasattr(subscription.billing_cycle, "value")
        else str(subscription.billing_cycle)
    )

    channel = Channel(
        account_id=account_id,
        organization_id=payload.organization_id,
        type=payload.type,
        name=payload.name,
        external_id=payload.external_id,
        billing_starts_at=subscription.starts_at,
        billing_ends_at=subscription.ends_at,
        billing_cycle=billing_cycle,
        included_mac=included,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    return channel


async def archive_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    membership: Membership | None = None,
) -> Channel:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("CHANNEL_NOT_FOUND")

    if membership is not None:
        await ensure_membership_channel_access(
            db,
            account_id=account_id,
            membership=membership,
            channel_id=channel.id,
        )

    now = datetime.now(UTC)
    channel.deleted_at = now
    channel.status = ChannelStatus.DISCONNECTED

    wa = (
        await db.execute(
            select(WhatsAppAccount).where(
                WhatsAppAccount.account_id == account_id,
                WhatsAppAccount.channel_id == channel.id,
            )
        )
    ).scalar_one_or_none()
    if wa is not None and wa.status != WhatsAppAccountStatus.DISCONNECTED:
        wa.status = WhatsAppAccountStatus.DISCONNECTED

    await db.commit()
    await db.refresh(channel)
    return channel


async def get_channel_usage_board(
    db: AsyncSession,
    *,
    account_id: UUID,
    cycle_month: str | None = None,
) -> ChannelUsageBoardResponse:
    summary = await get_account_mac_summary(db, account_id=account_id, cycle_month=cycle_month)
    channels = await list_channels(db, account_id)
    cycle = str(summary["cycle_month"])
    period_start = summary["billing_period_start"]
    period_end = summary["billing_period_end"]

    wa_rows = list(
        (
            await db.execute(
                select(WhatsAppAccount).where(WhatsAppAccount.account_id == account_id)
            )
        ).scalars().all()
    )
    wa_by_channel = {item.channel_id: item for item in wa_rows}

    items: list[ChannelUsageBoardItem] = []
    for channel in channels:
        billing = await channel_billing_payload(
            db,
            account_id=account_id,
            channel=channel,
        )
        ch_period_start = billing["billing_period_start"]
        ch_period_end = billing["billing_period_end"]
        campaign_msgs = await count_campaign_messages_for_channel(
            db,
            account_id=account_id,
            channel_id=channel.id,
            period_start=ch_period_start,
            period_end=ch_period_end,
        )
        wa = wa_by_channel.get(channel.id)
        cycle = str(billing["cycle_month"]) or cycle
        items.append(
            ChannelUsageBoardItem(
                channel_id=channel.id,
                channel_name=channel.name,
                organization_id=channel.organization_id,
                channel_type=channel.type,
                channel_status=channel.status,
                external_id=channel.external_id,
                cycle_month=cycle,
                mac_count=int(billing["mac_count"]),
                included_mac=int(billing["included_mac"]),
                mac_remaining=int(billing["mac_remaining"]),
                is_over_mac=bool(billing["is_over_mac"]),
                over_mac_count=int(billing["over_mac_count"]),
                campaign_messages_sent=campaign_msgs,
                whatsapp_status=_enum_str(wa.status) if wa else None,
                whatsapp_phone=wa.display_phone_number if wa else None,
                whatsapp_verified_name=wa.verified_name if wa else None,
                subscription_starts_at=billing["subscription_starts_at"],
                subscription_ends_at=billing["subscription_ends_at"],
                billing_period_start=billing["billing_period_start"],
                billing_period_end=billing["billing_period_end"],
                over_mac_price_per_100=float(billing["over_mac_price_per_100"]),
                attributed_over_mac_count=int(billing["attributed_over_mac_count"]),
                estimated_channel_over_mac_charge=float(
                    billing["estimated_channel_over_mac_charge"]
                ),
            )
        )

    return ChannelUsageBoardResponse(
        cycle_month=cycle,
        mac_count=int(summary["mac_count"]),
        included_mac=int(summary["included_mac"]),
        mac_remaining=int(summary["mac_remaining"]),
        is_over_mac=bool(summary["is_over_mac"]),
        over_mac_count=int(summary["over_mac_count"]),
        over_mac_blocks=int(summary["over_mac_blocks"]),
        over_mac_price_per_100=float(summary["over_mac_price_per_100"]),
        estimated_over_mac_charge=float(summary["estimated_over_mac_charge"]),
        subscription_starts_at=summary.get("subscription_starts_at"),
        subscription_ends_at=summary.get("subscription_ends_at"),
        billing_period_start=period_start,
        billing_period_end=period_end,
        channels=items,
    )
