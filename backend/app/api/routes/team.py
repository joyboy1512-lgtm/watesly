import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.config import settings
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.team import (
    AcceptInvitationRequest,
    EmployeeResponse,
    EmployeeUpdateRequest,
    InvitationResponse,
    InviteEmployeeRequest,
)
from app.services.team import (
    accept_invitation,
    create_invitation,
    list_employees,
    update_employee,
)
from app.services.membership_channels import list_membership_channel_ids

router = APIRouter()


async def _employee_response(
    db: AsyncSession,
    *,
    membership,
    user,
    organization_ids: list,
) -> EmployeeResponse:
    channel_ids = await list_membership_channel_ids(db, membership.id)
    return EmployeeResponse(
        user_id=user.id,
        membership_id=membership.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
        organization_ids=organization_ids,
        channel_ids=channel_ids,
    )


@router.post("/invitations", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def invite_employee(
    payload: InviteEmployeeRequest,
    context: AuthContext = Depends(require_permissions(Permission.USERS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
) -> InvitationResponse:
    try:
        invitation, token = await create_invitation(
            db,
            account_id=context.account_id,
            invited_by_user_id=context.user.id,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "INVALID_ORGANIZATION": (400, "One or more organizations are invalid"),
            "ALREADY_MEMBER": (409, "This user is already a member of the account"),
            "USER_LIMIT_REACHED": (403, "User limit reached for this plan"),
            "NO_ACTIVE_SUBSCRIPTION": (402, "An active subscription is required"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to create invitation"))
        raise HTTPException(status_code=code, detail=detail) from exc

    return InvitationResponse(
        invitation_id=invitation.id,
        invitation_token=token,
        expires_in_hours=settings.invitation_token_expire_hours,
    )


@router.post("/invitations/accept", response_model=EmployeeResponse)
async def accept_employee_invitation(
    payload: AcceptInvitationRequest,
    db: AsyncSession = Depends(get_db),
) -> EmployeeResponse:
    try:
        user, membership, organization_ids = await accept_invitation(db, payload)
    except (ValueError, jwt.InvalidTokenError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired invitation") from exc

    return await _employee_response(
        db,
        membership=membership,
        user=user,
        organization_ids=organization_ids,
    )


@router.get("/employees", response_model=list[EmployeeResponse])
async def get_employees(
    context: AuthContext = Depends(require_permissions(Permission.USERS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[EmployeeResponse]:
    rows = await list_employees(db, context.account_id)
    return [
        await _employee_response(
            db,
            membership=membership,
            user=user,
            organization_ids=organization_ids,
        )
        for membership, user, organization_ids in rows
    ]


@router.patch("/employees/{membership_id}", response_model=EmployeeResponse)
async def patch_employee(
    membership_id,
    payload: EmployeeUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.USERS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
) -> EmployeeResponse:
    try:
        membership, user, organization_ids = await update_employee(
            db,
            account_id=context.account_id,
            membership_id=membership_id,
            actor_membership_id=context.membership.id,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "EMPLOYEE_NOT_FOUND": (404, "Employee not found"),
            "CANNOT_SUSPEND_SELF": (400, "You cannot suspend your own membership"),
            "LAST_OWNER": (400, "The account must have at least one active owner"),
            "INVALID_ORGANIZATION": (400, "One or more organizations are invalid"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to update employee"))
        raise HTTPException(status_code=code, detail=detail) from exc

    return await _employee_response(
        db,
        membership=membership,
        user=user,
        organization_ids=organization_ids,
    )
