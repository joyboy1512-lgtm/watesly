from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.membership import Membership, MembershipStatus
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.schemas.organization import OrganizationCreateRequest, OrganizationResponse
from app.services.billing import get_active_subscription
from app.services.plan_limits import is_unlimited, limit_reached, organization_limit_reached


async def list_organizations(db: AsyncSession, account_id: UUID) -> list[Organization]:
    result = await db.execute(
        select(Organization)
        .where(Organization.account_id == account_id)
        .order_by(Organization.created_at.asc())
    )
    return list(result.scalars().all())


async def count_organization_members(db: AsyncSession, organization_id: UUID) -> int:
    count = await db.scalar(
        select(func.count(Membership.id))
        .select_from(Membership)
        .join(OrganizationMembership, OrganizationMembership.membership_id == Membership.id)
        .where(
            OrganizationMembership.organization_id == organization_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    return int(count or 0)


async def count_organization_channels(db: AsyncSession, organization_id: UUID) -> int:
    count = await db.scalar(
        select(func.count(Channel.id)).where(
            Channel.organization_id == organization_id,
            Channel.deleted_at.is_(None),
        )
    )
    return int(count or 0)


async def build_organization_response(db: AsyncSession, organization: Organization) -> OrganizationResponse:
    return OrganizationResponse(
        id=organization.id,
        name=organization.name,
        slug=organization.slug,
        country_code=organization.country_code,
        currency_code=organization.currency_code,
        timezone=organization.timezone,
        default_language=organization.default_language,
        status=organization.status.value if hasattr(organization.status, "value") else str(organization.status),
        max_users=organization.max_users,
        max_channels=organization.max_channels,
        active_member_count=await count_organization_members(db, organization.id),
        active_channel_count=await count_organization_channels(db, organization.id),
    )


async def create_organization(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: OrganizationCreateRequest,
) -> Organization:
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is None:
        raise ValueError("NO_ACTIVE_SUBSCRIPTION")
    _, plan = subscription_data

    current_count = await db.scalar(
        select(func.count(Organization.id)).where(Organization.account_id == account_id)
    )
    if current_count is None:
        current_count = 0

    if organization_limit_reached(
        current_count=current_count,
        max_organizations=plan.max_organizations,
    ):
        raise ValueError("ORGANIZATION_LIMIT_REACHED")

    if payload.branch_admin_email and not is_unlimited(payload.max_users) and payload.max_users < 1:
        raise ValueError("ORG_USER_LIMIT_TOO_LOW_FOR_ADMIN")

    organization = Organization(
        account_id=account_id,
        name=payload.name,
        slug=payload.slug,
        country_code=payload.country_code,
        currency_code=payload.currency_code,
        timezone=payload.timezone,
        default_language=payload.default_language,
        max_users=payload.max_users,
        max_channels=payload.max_channels,
    )
    db.add(organization)
    await db.commit()
    await db.refresh(organization)
    return organization
