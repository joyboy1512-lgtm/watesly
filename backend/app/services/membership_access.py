"""Resolve organization and channel access for account memberships."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.channel import Channel
from app.models.membership import Membership, MembershipRole
from app.models.organization import Organization, OrganizationStatus
from app.models.organization_membership import OrganizationMembership
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import WhatsAppTemplate
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


async def ensure_membership_organization_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    organization_id: UUID,
) -> None:
    allowed = await resolve_accessible_organization_ids(
        db, account_id=account_id, membership=membership
    )
    if allowed is None:
        return
    if organization_id not in allowed:
        raise ValueError("ACCESS_FORBIDDEN")


async def ensure_whatsapp_account_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    whatsapp_account_id: UUID,
) -> WhatsAppAccount:
    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != account_id:
        raise ValueError("INVALID_WHATSAPP_ACCOUNT")
    await ensure_membership_organization_access(
        db,
        account_id=account_id,
        membership=membership,
        organization_id=wa.organization_id,
    )
    await ensure_membership_channel_access(
        db,
        account_id=account_id,
        membership=membership,
        channel_id=wa.channel_id,
    )
    return wa


async def ensure_campaign_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    campaign: Campaign,
) -> None:
    await ensure_membership_organization_access(
        db,
        account_id=account_id,
        membership=membership,
        organization_id=campaign.organization_id,
    )
    wa = await db.get(WhatsAppAccount, campaign.whatsapp_account_id)
    if wa is None or wa.account_id != account_id:
        raise ValueError("CAMPAIGN_NOT_FOUND")
    await ensure_membership_channel_access(
        db,
        account_id=account_id,
        membership=membership,
        channel_id=wa.channel_id,
    )


async def ensure_template_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    template: WhatsAppTemplate,
) -> None:
    await ensure_membership_organization_access(
        db,
        account_id=account_id,
        membership=membership,
        organization_id=template.organization_id,
    )
    await ensure_whatsapp_account_access(
        db,
        account_id=account_id,
        membership=membership,
        whatsapp_account_id=template.whatsapp_account_id,
    )


async def campaign_list_filters(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
) -> list:
    org_ids = await resolve_accessible_organization_ids(
        db, account_id=account_id, membership=membership
    )
    channel_ids = await resolve_accessible_channel_ids(
        db, account_id=account_id, membership=membership
    )
    filters = []
    if org_ids is not None:
        if not org_ids:
            return [Campaign.id.is_(None)]
        filters.append(Campaign.organization_id.in_(org_ids))
    if channel_ids is not None:
        if not channel_ids:
            return [Campaign.id.is_(None)]
        wa_ids = select(WhatsAppAccount.id).where(
            WhatsAppAccount.account_id == account_id,
            WhatsAppAccount.channel_id.in_(channel_ids),
        )
        filters.append(Campaign.whatsapp_account_id.in_(wa_ids))
    return filters


async def template_list_filters(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
) -> list:
    org_ids = await resolve_accessible_organization_ids(
        db, account_id=account_id, membership=membership
    )
    channel_ids = await resolve_accessible_channel_ids(
        db, account_id=account_id, membership=membership
    )
    filters = []
    if org_ids is not None:
        if not org_ids:
            return [WhatsAppTemplate.id.is_(None)]
        filters.append(WhatsAppTemplate.organization_id.in_(org_ids))
    if channel_ids is not None:
        if not channel_ids:
            return [WhatsAppTemplate.id.is_(None)]
        wa_ids = select(WhatsAppAccount.id).where(
            WhatsAppAccount.account_id == account_id,
            WhatsAppAccount.channel_id.in_(channel_ids),
        )
        filters.append(WhatsAppTemplate.whatsapp_account_id.in_(wa_ids))
    return filters


async def organization_scope_clauses(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    organization_column,
) -> list:
    """Return SQLAlchemy filters limiting rows to accessible organizations."""
    org_ids = await resolve_accessible_organization_ids(
        db, account_id=account_id, membership=membership
    )
    if org_ids is None:
        return []
    if not org_ids:
        return [organization_column.is_(None)]
    return [organization_column.in_(org_ids)]


async def resolve_membership_organizations(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
) -> list[Organization]:
    result = await db.execute(
        select(Organization).where(
            Organization.account_id == account_id,
            Organization.status == OrganizationStatus.ACTIVE,
        ).order_by(Organization.name.asc())
    )
    organizations = list(result.scalars().all())
    return await filter_organizations_for_membership(
        db,
        account_id=account_id,
        membership=membership,
        organizations=organizations,
    )


def branch_display_name(organizations: list[Organization]) -> str | None:
    if not organizations:
        return None
    if len(organizations) == 1:
        return organizations[0].name
    return " · ".join(item.name for item in organizations[:3])
