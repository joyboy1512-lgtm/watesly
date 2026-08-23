from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.schemas.organization import OrganizationCreateRequest
from app.services.billing import get_active_subscription
from app.services.plan_limits import organization_limit_reached


async def list_organizations(db: AsyncSession, account_id: UUID) -> list[Organization]:
    result = await db.execute(
        select(Organization)
        .where(Organization.account_id == account_id)
        .order_by(Organization.created_at.asc())
    )
    return list(result.scalars().all())


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

    organization = Organization(account_id=account_id, **payload.model_dump())
    db.add(organization)
    await db.commit()
    await db.refresh(organization)
    return organization
