from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.invitation_channel_access import InvitationChannelAccess
from app.models.membership import MembershipRole
from app.models.membership_channel_access import MembershipChannelAccess
from app.models.organization import Organization


async def validate_channel_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_ids: set[UUID],
    channel_ids: list[UUID],
) -> set[UUID]:
    if not channel_ids:
        return set()
    result = await db.execute(
        select(Channel.id, Channel.organization_id).where(
            Channel.account_id == account_id,
            Channel.id.in_(channel_ids),
            Channel.deleted_at.is_(None),
        )
    )
    rows = result.all()
    valid_ids = set()
    for channel_id, organization_id in rows:
        if organization_id in organization_ids:
            valid_ids.add(channel_id)
    if valid_ids != set(channel_ids):
        raise ValueError("INVALID_CHANNEL")
    return valid_ids


async def replace_membership_channel_access(
    db: AsyncSession,
    *,
    membership_id: UUID,
    channel_ids: set[UUID],
) -> None:
    await db.execute(
        delete(MembershipChannelAccess).where(
            MembershipChannelAccess.membership_id == membership_id
        )
    )
    if channel_ids:
        db.add_all([
            MembershipChannelAccess(membership_id=membership_id, channel_id=channel_id)
            for channel_id in channel_ids
        ])


async def list_membership_channel_ids(db: AsyncSession, membership_id: UUID) -> list[UUID]:
    result = await db.execute(
        select(MembershipChannelAccess.channel_id).where(
            MembershipChannelAccess.membership_id == membership_id
        )
    )
    return list(result.scalars().all())


async def get_accessible_channel_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_id: UUID,
    role: MembershipRole,
    organization_ids: list[UUID],
) -> list[UUID] | None:
    """Return None for all account channels (owner/admin), else allowed channel IDs."""
    if role in (MembershipRole.OWNER, MembershipRole.ADMIN):
        return None
    explicit = await list_membership_channel_ids(db, membership_id)
    if explicit:
        return explicit
    if not organization_ids:
        return []
    result = await db.execute(
        select(Channel.id).where(
            Channel.account_id == account_id,
            Channel.organization_id.in_(organization_ids),
            Channel.deleted_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def filter_channels_for_membership(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_id: UUID,
    role: MembershipRole,
    organization_ids: list[UUID],
    channels: list,
) -> list:
    accessible = await get_accessible_channel_ids(
        db,
        account_id=account_id,
        membership_id=membership_id,
        role=role,
        organization_ids=organization_ids,
    )
    if accessible is None:
        if role in (MembershipRole.OWNER, MembershipRole.ADMIN):
            return channels
        org_set = set(organization_ids)
        return [item for item in channels if item.organization_id in org_set]
    allowed = set(accessible)
    return [item for item in channels if item.id in allowed]