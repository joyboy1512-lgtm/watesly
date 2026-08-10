from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.permissions import (
    BRANCH_ADMIN_ASSIGNABLE_PERMISSIONS,
    BRANCH_SCOPED_ROLES,
    MANAGER_ASSIGNABLE_PERMISSIONS,
    ROLE_RANK,
    validate_custom_permissions_for_role,
)
from app.core.security import create_invitation_token, decode_invitation_token, hash_password
from app.models.invitation_channel_access import InvitationChannelAccess
from app.models.invitation import Invitation, InvitationStatus
from app.models.invitation_organization import InvitationOrganization
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.user import User, UserStatus
from app.schemas.team import (
    AcceptInvitationRequest,
    CreateEmployeeRequest,
    EmployeeUpdateRequest,
    InviteEmployeeRequest,
)
from app.services.billing import get_active_subscription
from app.services.membership_channels import replace_membership_channel_access, validate_channel_ids
from app.services.membership_access import list_membership_organization_ids


async def _membership_organization_ids(db: AsyncSession, membership_id: UUID) -> set[UUID]:
    return set(await list_membership_organization_ids(db, membership_id))


async def _replace_invitation_channel_access(
    db: AsyncSession,
    *,
    invitation_id: UUID,
    channel_ids: set[UUID],
) -> None:
    await db.execute(
        delete(InvitationChannelAccess).where(
            InvitationChannelAccess.invitation_id == invitation_id
        )
    )
    if channel_ids:
        db.add_all([
            InvitationChannelAccess(invitation_id=invitation_id, channel_id=channel_id)
            for channel_id in channel_ids
        ])


async def _apply_membership_channel_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_id: UUID,
    organization_ids: set[UUID],
    channel_ids: list[UUID] | None,
) -> None:
    if channel_ids is None:
        return
    if channel_ids:
        valid = await validate_channel_ids(
            db,
            account_id=account_id,
            organization_ids=organization_ids,
            channel_ids=channel_ids,
        )
        await replace_membership_channel_access(
            db, membership_id=membership_id, channel_ids=valid
        )
    else:
        await replace_membership_channel_access(
            db, membership_id=membership_id, channel_ids=set()
        )


def _assignable_permissions_for_actor(actor_role: MembershipRole):
    if actor_role in (MembershipRole.OWNER, MembershipRole.ADMIN):
        return None
    if actor_role == MembershipRole.BRANCH_ADMIN:
        return BRANCH_ADMIN_ASSIGNABLE_PERMISSIONS
    if actor_role == MembershipRole.MANAGER:
        return MANAGER_ASSIGNABLE_PERMISSIONS
    return frozenset()


def _protected_roles_for_actor(actor_role: MembershipRole) -> frozenset[MembershipRole]:
    protected = {MembershipRole.OWNER, MembershipRole.ADMIN}
    if actor_role == MembershipRole.MANAGER:
        protected.add(MembershipRole.BRANCH_ADMIN)
    if actor_role == MembershipRole.BRANCH_ADMIN:
        protected.add(MembershipRole.BRANCH_ADMIN)
    return protected


def _max_assignable_role(actor_role: MembershipRole) -> MembershipRole:
    if actor_role in (MembershipRole.OWNER, MembershipRole.ADMIN):
        return MembershipRole.ADMIN
    if actor_role == MembershipRole.BRANCH_ADMIN:
        return MembershipRole.MANAGER
    return MembershipRole.MANAGER


def _assert_actor_can_manage_target(
    *,
    actor_role: MembershipRole,
    actor_org_ids: set[UUID],
    target_role: MembershipRole,
    target_org_ids: set[UUID],
    new_role: MembershipRole | None = None,
) -> None:
    effective_role = new_role or target_role
    if actor_role in (MembershipRole.OWNER, MembershipRole.ADMIN):
        return
    if actor_role not in BRANCH_SCOPED_ROLES:
        raise ValueError("FORBIDDEN")

    protected = _protected_roles_for_actor(actor_role)
    if target_role in protected or effective_role in protected:
        raise ValueError("FORBIDDEN")
    if ROLE_RANK[effective_role] > ROLE_RANK[_max_assignable_role(actor_role)]:
        raise ValueError("FORBIDDEN")
    if not target_org_ids or not target_org_ids.issubset(actor_org_ids):
        raise ValueError("OUT_OF_SCOPE")


async def create_invitation(
    db: AsyncSession,
    *,
    account_id: UUID,
    invited_by_user_id: UUID,
    actor_membership: Membership,
    payload: InviteEmployeeRequest,
) -> tuple[Invitation, str]:
    actor_org_ids = await _membership_organization_ids(db, actor_membership.id)
    _assert_actor_can_manage_target(
        actor_role=actor_membership.role,
        actor_org_ids=actor_org_ids,
        target_role=payload.role,
        target_org_ids=set(payload.organization_ids),
    )
    if actor_membership.role in BRANCH_SCOPED_ROLES and not set(payload.organization_ids).issubset(actor_org_ids):
        raise ValueError("OUT_OF_SCOPE")
    await _validate_new_member_capacity(db, account_id=account_id, email=payload.email)
    valid_ids = await _validate_organization_ids(
        db,
        account_id=account_id,
        organization_ids=payload.organization_ids,
    )

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
    if payload.channel_ids:
        channel_ids = await validate_channel_ids(
            db,
            account_id=account_id,
            organization_ids=valid_ids,
            channel_ids=payload.channel_ids,
        )
        await _replace_invitation_channel_access(
            db, invitation_id=invitation.id, channel_ids=channel_ids
        )
    await db.commit()
    return invitation, create_invitation_token(invitation_id=invitation.id)


async def _validate_new_member_capacity(
    db: AsyncSession,
    *,
    account_id: UUID,
    email: str,
) -> None:
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

    existing_membership = await db.execute(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.account_id == account_id, User.email == email)
    )
    if existing_membership.scalar_one_or_none() is not None:
        raise ValueError("ALREADY_MEMBER")


async def _validate_organization_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_ids: list[UUID],
) -> set[UUID]:
    result = await db.execute(
        select(Organization.id).where(
            Organization.account_id == account_id,
            Organization.id.in_(organization_ids),
        )
    )
    valid_ids = set(result.scalars().all())
    if valid_ids != set(organization_ids):
        raise ValueError("INVALID_ORGANIZATION")
    return valid_ids


async def create_employee(
    db: AsyncSession,
    *,
    account_id: UUID,
    actor_membership: Membership,
    payload: CreateEmployeeRequest,
) -> tuple[Membership, User, list[UUID]]:
    actor_org_ids = await _membership_organization_ids(db, actor_membership.id)
    _assert_actor_can_manage_target(
        actor_role=actor_membership.role,
        actor_org_ids=actor_org_ids,
        target_role=payload.role,
        target_org_ids=set(payload.organization_ids),
    )
    await _validate_new_member_capacity(db, account_id=account_id, email=payload.email)
    valid_ids = await _validate_organization_ids(
        db,
        account_id=account_id,
        organization_ids=payload.organization_ids,
    )

    existing_user = await db.execute(select(User).where(User.email == payload.email))
    if existing_user.scalar_one_or_none() is not None:
        raise ValueError("EMAIL_ALREADY_REGISTERED")

    user = User(
        email=payload.email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        preferred_language=payload.preferred_language,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()

    membership = Membership(
        account_id=account_id,
        user_id=user.id,
        role=payload.role,
        status=MembershipStatus.ACTIVE,
    )
    db.add(membership)
    await db.flush()

    if payload.permissions is not None:
        if len(payload.permissions) == 0:
            membership.custom_permissions = None
        else:
            assignable = _assignable_permissions_for_actor(actor_membership.role)
            membership.custom_permissions = validate_custom_permissions_for_role(
                payload.role,
                payload.permissions,
                assignable=assignable,
            )

    db.add_all([
        OrganizationMembership(
            organization_id=organization_id,
            membership_id=membership.id,
        )
        for organization_id in valid_ids
    ])
    await _apply_membership_channel_access(
        db,
        account_id=account_id,
        membership_id=membership.id,
        organization_ids=valid_ids,
        channel_ids=payload.channel_ids,
    )
    await db.commit()
    return membership, user, list(valid_ids)


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
        channel_result = await db.execute(
            select(InvitationChannelAccess.channel_id).where(
                InvitationChannelAccess.invitation_id == invitation.id
            )
        )
        invitation_channel_ids = list(channel_result.scalars().all())
        if invitation_channel_ids:
            await replace_membership_channel_access(
                db,
                membership_id=membership.id,
                channel_ids=set(invitation_channel_ids),
            )
        invitation.status = InvitationStatus.ACCEPTED
        invitation.accepted_at = now

    await db.commit()
    return user, membership, organization_ids


async def list_employees(
    db: AsyncSession,
    account_id: UUID,
    *,
    actor_membership: Membership | None = None,
) -> list[tuple[Membership, User, list[UUID]]]:
    result = await db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.account_id == account_id)
        .order_by(Membership.created_at.asc())
    )
    actor_org_ids: set[UUID] | None = None
    if actor_membership is not None and actor_membership.role in BRANCH_SCOPED_ROLES:
        actor_org_ids = await _membership_organization_ids(db, actor_membership.id)
    employees = []
    for membership, user in result.all():
        org_result = await db.execute(
            select(OrganizationMembership.organization_id).where(
                OrganizationMembership.membership_id == membership.id
            )
        )
        organization_ids = list(org_result.scalars().all())
        if actor_org_ids is not None:
            if membership.role in (MembershipRole.OWNER, MembershipRole.ADMIN):
                continue
            if (
                actor_membership.role == MembershipRole.MANAGER
                and membership.role == MembershipRole.BRANCH_ADMIN
            ):
                continue
            if (
                actor_membership.role == MembershipRole.BRANCH_ADMIN
                and membership.role == MembershipRole.BRANCH_ADMIN
                and membership.id != actor_membership.id
            ):
                continue
            if not set(organization_ids) & actor_org_ids:
                continue
        employees.append((membership, user, organization_ids))
    return employees


async def update_employee(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_id: UUID,
    actor_membership: Membership,
    payload: EmployeeUpdateRequest,
) -> tuple[Membership, User, list[UUID]]:
    membership = await db.get(Membership, membership_id)
    if membership is None or membership.account_id != account_id:
        raise ValueError("EMPLOYEE_NOT_FOUND")
    actor_org_ids = await _membership_organization_ids(db, actor_membership.id)
    target_org_ids = await _membership_organization_ids(db, membership.id)
    _assert_actor_can_manage_target(
        actor_role=actor_membership.role,
        actor_org_ids=actor_org_ids,
        target_role=membership.role,
        target_org_ids=target_org_ids,
        new_role=payload.role,
    )
    if membership.id == actor_membership.id and payload.status == MembershipStatus.SUSPENDED:
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
        valid_ids = set(payload.organization_ids)
        if actor_membership.role in BRANCH_SCOPED_ROLES and not valid_ids.issubset(actor_org_ids):
            raise ValueError("OUT_OF_SCOPE")
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
        target_org_ids = valid_ids
    else:
        target_org_ids = await _membership_organization_ids(db, membership.id)

    if payload.channel_ids is not None:
        if actor_membership.role in BRANCH_SCOPED_ROLES and not target_org_ids.issubset(actor_org_ids):
            raise ValueError("OUT_OF_SCOPE")
        await _apply_membership_channel_access(
            db,
            account_id=account_id,
            membership_id=membership.id,
            organization_ids=target_org_ids,
            channel_ids=payload.channel_ids,
        )

    if payload.permissions is not None:
        if len(payload.permissions) == 0:
            membership.custom_permissions = None
        else:
            effective_role = payload.role or membership.role
            assignable = _assignable_permissions_for_actor(actor_membership.role)
            membership.custom_permissions = validate_custom_permissions_for_role(
                effective_role,
                payload.permissions,
                assignable=assignable,
            )

    await db.commit()
    user = await db.get(User, membership.user_id)
    org_result = await db.execute(
        select(OrganizationMembership.organization_id).where(
            OrganizationMembership.membership_id == membership.id
        )
    )
    return membership, user, list(org_result.scalars().all())
