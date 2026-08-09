"""Resolve organization and channel access for account memberships."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.membership import Membership, MembershipRole
from app.models.organization import Organization, OrganizationStatus
from app.models.organization_membership import OrganizationMembership
from app.services.membership_channels import (
    get_accessible_channel_ids,
    list_membership_channel_ids,
)


async def list_membership_organization_ids(db: AsyncSession, membership_id: UUID) -> list[UUID]:
    result = await db.execute(
        select(OrganizationMembership.organization_id).where(
            OrganizationMembership.membership_id == membership_id
        )
    )
    return list(result.scalars().all())


async def resolve_accessible_organization_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
) -> list[UUID] | None:
    """None means all organizations in the account (owner/admin)."""
    if membership.role in (MembershipRole.OWNER, MembershipRole.ADMIN):
        return None
    return await list_membership_organization_ids(db, membership.id)


async def resolve_accessible_channel_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
) -> list[UUID] | None:
    """None means all channels in the account (owner/admin)."""
    organization_ids = await list_membership_organization_ids(db, membership.id)
    return await get_accessible_channel_ids(
        db,
        account_id=account_id,
        membership_id=membership.id,
        role=membership.role,
        organization_ids=organization_ids,
    )


async def ensure_membership_channel_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    channel_id: UUID,
) -> None:
    accessible = await resolve_accessible_channel_ids(
        db, account_id=account_id, membership=membership
    )
    if accessible is None:
        return
    if channel_id not in accessible:
        raise ValueError("CONVERSATION_FORBIDDEN")


async def filter_organizations_for_membership(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    organizations: list[Organization],
) -> list[Organization]:
    allowed = await resolve_accessible_organization_ids(
        db, account_id=account_id, membership=membership
    )
    if allowed is None:
        return organizations
    allowed_set = set(allowed)
    return [item for item in organizations if item.id in allowed_set]


async def filter_channels_for_membership(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    channels: list[Channel],
) -> list[Channel]:
    accessible = await resolve_accessible_channel_ids(
        db, account_id=account_id, membership=membership
    )
    if accessible is None:
        return channels
    allowed = set(accessible)
    return [item for item in channels if item.id in allowed]


async def has_explicit_channel_restrictions(db: AsyncSession, membership_id: UUID) -> bool:
    return bool(await list_membership_channel_ids(db, membership_id))
