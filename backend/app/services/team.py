from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_invitation_token, decode_invitation_token, hash_password
from app.models.invitation import Invitation, InvitationStatus
from app.models.invitation_organization import InvitationOrganization
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.user import User, UserStatus
from app.schemas.team import AcceptInvitationRequest, EmployeeUpdateRequest, InviteEmployeeRequest
from app.services.billing import get_active_subscription


async def create_invitation(
    db: AsyncSession,
    *,
    account_id: UUID,
    invited_by_user_id: UUID,
    payload: InviteEmployeeRequest,
) -> tuple[Invitation, str]:
    subscription_data = await get_active_subscription(db, account_id)
    if subscription_data is None:
        raise ValueError("NO_ACTIVE_SUBSCRIPTION")
    _, plan = subscription_data

    member_count = await db.scalar(
        select(func.count(Membership.id)).where(
            Membership.account_id == account_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    if (member_count or 0) >= plan.max_users:
        raise ValueError("USER_LIMIT_REACHED")

    result = await db.execute(
        select(Organization.id).where(
            Organization.account_id == account_id,
            Organization.id.in_(payload.organization_ids),
        )
    )
    valid_ids = set(result.scalars().all())
    if valid_ids != set(payload.organization_ids):
        raise ValueError("INVALID_ORGANIZATION")

    existing_membership = await db.execute(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.account_id == account_id, User.email == payload.email)
    )
    if existing_membership.scalar_one_or_none() is not None:
        raise ValueError("ALREADY_MEMBER")

    invitation = Invitation(
        account_id=account_id,
        email=payload.email,
        role=payload.role,
        invited_by_user_id=invited_by_user_id,
        expires_at=datetime.now(UTC) + timedelta(hours=settings.invitation_token_expire_hours),
    )
    db.add(invitation)
    await db.flush()
    db.add_all([
        InvitationOrganization(invitation_id=invitation.id, organization_id=org_id)
        for org_id in valid_ids
    ])
    await db.commit()
    return invitation, create_invitation_token(invitation_id=invitation.id)


async def accept_invitation(
    db: AsyncSession, payload: AcceptInvitationRequest
) -> tuple[User, Membership, list[UUID]]:
    invitation_id = decode_invitation_token(payload.token)
    invitation = await db.get(Invitation, invitation_id)
    now = datetime.now(UTC)
    if (
        invitation is None
        or invitation.status != InvitationStatus.PENDING
        or invitation.expires_at <= now
    ):
        raise ValueError("INVALID_INVITATION")

    result = await db.execute(select(User).where(User.email == invitation.email))
    user = result.scalar_one_or_none()

    async with db.begin_nested():
        if user is None:
            user = User(
                email=invitation.email,
                full_name=payload.full_name,
                password_hash=hash_password(payload.password),
                preferred_language=payload.preferred_language,
                status=UserStatus.ACTIVE,
            )
            db.add(user)
            await db.flush()

        membership = Membership(
            account_id=invitation.account_id,
            user_id=user.id,
            role=invitation.role,
            status=MembershipStatus.ACTIVE,
        )
        db.add(membership)
        await db.flush()

        org_result = await db.execute(
            select(InvitationOrganization.organization_id).where(
                InvitationOrganization.invitation_id == invitation.id
            )
        )
        organization_ids = list(org_result.scalars().all())
        db.add_all([
            OrganizationMembership(
                organization_id=organization_id,
                membership_id=membership.id,
            )
            for organization_id in organization_ids
        ])
        invitation.status = InvitationStatus.ACCEPTED
        invitation.accepted_at = now

    await db.commit()
    return user, membership, organization_ids


async def list_employees(db: AsyncSession, account_id: UUID) -> list[tuple[Membership, User, list[UUID]]]:
    result = await db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.account_id == account_id)
        .order_by(Membership.created_at.asc())
    )
    employees = []
    for membership, user in result.all():
        org_result = await db.execute(
            select(OrganizationMembership.organization_id).where(
                OrganizationMembership.membership_id == membership.id
            )
        )
        employees.append((membership, user, list(org_result.scalars().all())))
    return employees


async def update_employee(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_id: UUID,
    actor_membership_id: UUID,
    payload: EmployeeUpdateRequest,
) -> tuple[Membership, User, list[UUID]]:
    membership = await db.get(Membership, membership_id)
    if membership is None or membership.account_id != account_id:
        raise ValueError("EMPLOYEE_NOT_FOUND")
    if membership.id == actor_membership_id and payload.status == MembershipStatus.SUSPENDED:
        raise ValueError("CANNOT_SUSPEND_SELF")
    if membership.role == MembershipRole.OWNER and payload.role not in (None, MembershipRole.OWNER):
        owner_count = await db.scalar(
            select(func.count(Membership.id)).where(
                Membership.account_id == account_id,
                Membership.role == MembershipRole.OWNER,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
        if (owner_count or 0) <= 1:
            raise ValueError("LAST_OWNER")

    if payload.role is not None:
        membership.role = payload.role
    if payload.status is not None:
        membership.status = payload.status

    if payload.organization_ids is not None:
        result = await db.execute(
            select(Organization.id).where(
                Organization.account_id == account_id,
                Organization.id.in_(payload.organization_ids),
            )
        )
        valid_ids = set(result.scalars().all())
        if valid_ids != set(payload.organization_ids):
            raise ValueError("INVALID_ORGANIZATION")
        await db.execute(
            delete(OrganizationMembership).where(
                OrganizationMembership.membership_id == membership.id
            )
        )
        db.add_all([
            OrganizationMembership(
                organization_id=organization_id,
                membership_id=membership.id,
            )
            for organization_id in valid_ids
        ])

    await db.commit()
    user = await db.get(User, membership.user_id)
    org_result = await db.execute(
        select(OrganizationMembership.organization_id).where(
            OrganizationMembership.membership_id == membership.id
        )
    )
    return membership, user, list(org_result.scalars().all())
