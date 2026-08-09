import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.config import settings
from app.core.permissions import Permission, permissions_for_response
from app.db.session import get_db
from app.models.account import Account
from app.schemas.team import (
    AcceptInvitationRequest,
    CreateEmployeeRequest,
    EmployeeResponse,
    EmployeeUpdateRequest,
    InvitationResponse,
    InviteEmployeeRequest,
)
from app.services.team import (
    accept_invitation,
    create_employee,
    create_invitation,
    list_employees,
    update_employee,
)
from app.services.membership_channels import list_membership_channel_ids
from app.services.email import build_invitation_accept_url, is_smtp_configured, send_team_invitation_email

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
        permissions=permissions_for_response(membership),
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

    invite_url = build_invitation_accept_url(token)
    email_sent = False
    if is_smtp_configured():
        account = await db.get(Account, context.account_id)
        email_sent = await send_team_invitation_email(
            to=payload.email,
            invite_url=invite_url,
            expires_hours=settings.invitation_token_expire_hours,
            account_name=account.name if account else settings.app_name,
            role=payload.role,
        )

    return InvitationResponse(
        invitation_id=invitation.id,
        invitation_token=token,
        invitation_accept_url=invite_url,
        expires_in_hours=settings.invitation_token_expire_hours,
        email_sent=email_sent,
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


@router.post("/employees", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def create_employee_account(
    payload: CreateEmployeeRequest,
    context: AuthContext = Depends(require_permissions(Permission.USERS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
) -> EmployeeResponse:
    try:
        membership, user, organization_ids = await create_employee(
            db,
            account_id=context.account_id,
            actor_membership=context.membership,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "INVALID_ORGANIZATION": (400, "One or more organizations are invalid"),
            "ALREADY_MEMBER": (409, "This user is already a member of the account"),
            "EMAIL_ALREADY_REGISTERED": (409, "This email is already registered. Use an invitation link instead."),
            "USER_LIMIT_REACHED": (403, "User limit reached for this plan"),
            "NO_ACTIVE_SUBSCRIPTION": (402, "An active subscription is required"),
            "FORBIDDEN": (403, "You cannot create this employee"),
            "OUT_OF_SCOPE": (403, "You can only manage employees in your branch"),
            "INVALID_CHANNEL": (400, "One or more WhatsApp channels are invalid for the selected branches"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to create employee"))
        raise HTTPException(status_code=code, detail=detail) from exc

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
    rows = await list_employees(db, context.account_id, actor_membership=context.membership)
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
            actor_membership=context.membership,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "EMPLOYEE_NOT_FOUND": (404, "Employee not found"),
            "CANNOT_SUSPEND_SELF": (400, "You cannot suspend your own membership"),
            "LAST_OWNER": (400, "The account must have at least one active owner"),
            "INVALID_ORGANIZATION": (400, "One or more organizations are invalid"),
            "FORBIDDEN": (403, "You cannot modify this employee"),
            "OUT_OF_SCOPE": (403, "You can only manage employees in your branch"),
            "PERMISSION_EXCEEDS_ROLE": (400, "One or more permissions exceed the employee role"),
            "PERMISSION_NOT_ASSIGNABLE": (403, "You cannot assign one or more of these permissions"),
            "INVALID_PERMISSION": (400, "One or more permissions are invalid"),
            "INVALID_CHANNEL": (400, "One or more WhatsApp channels are invalid for the selected branches"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to update employee"))
        raise HTTPException(status_code=code, detail=detail) from exc

    return await _employee_response(
        db,
        membership=membership,
        user=user,
        organization_ids=organization_ids,
    )
