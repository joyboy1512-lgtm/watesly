from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.organization import Organization
from app.models.whatsapp_account import WhatsAppAccount
from app.schemas.channel import ChannelCreateRequest
from app.schemas.mac import ChannelUsageBoardItem, ChannelUsageBoardResponse
from app.services.billing import get_active_subscription
from app.services.mac_tracking import (
    count_campaign_messages_for_channel,
    count_mac_for_channel,
    compute_mac_balance,
    get_account_mac_summary,
)


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
    _, plan = subscription_data

    current_count = await db.scalar(
        select(func.count(Channel.id)).where(Channel.account_id == account_id, Channel.deleted_at.is_(None))
    )
    if (current_count or 0) >= plan.max_channels:
        raise ValueError("CHANNEL_LIMIT_REACHED")

    channel = Channel(
        account_id=account_id,
        organization_id=payload.organization_id,
        type=payload.type,
        name=payload.name,
        external_id=payload.external_id,
    )
    db.add(channel)
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
    included_per_channel = int(summary["included_mac"])

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
        mac_count = await count_mac_for_channel(
            db,
            account_id=account_id,
            channel_id=channel.id,
            cycle_month=cycle,
        )
        campaign_msgs = await count_campaign_messages_for_channel(
            db,
            account_id=account_id,
            channel_id=channel.id,
            cycle_month=cycle,
        )
        wa = wa_by_channel.get(channel.id)
        channel_balance = compute_mac_balance(
            mac_count=mac_count,
            included_mac=included_per_channel,
        )
        items.append(
            ChannelUsageBoardItem(
                channel_id=channel.id,
                channel_name=channel.name,
                organization_id=channel.organization_id,
                channel_type=channel.type,
                channel_status=channel.status,
                external_id=channel.external_id,
                cycle_month=cycle,
                mac_count=mac_count,
                included_mac=included_per_channel,
                mac_remaining=int(channel_balance["mac_remaining"]),
                is_over_mac=bool(channel_balance["is_over_mac"]),
                campaign_messages_sent=campaign_msgs,
                whatsapp_status=_enum_str(wa.status) if wa else None,
                whatsapp_phone=wa.display_phone_number if wa else None,
                whatsapp_verified_name=wa.verified_name if wa else None,
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
        channels=items,
    )
