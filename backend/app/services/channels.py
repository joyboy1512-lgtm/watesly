from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.organization import Organization
from app.schemas.channel import ChannelCreateRequest
from app.services.billing import get_active_subscription


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
