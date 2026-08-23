from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, get_auth_context, require_permissions
from app.core.config import settings
from app.core.permissions import Permission
from app.db.session import get_db
from app.models.account import Account
from app.models.membership import Membership, MembershipRole
from app.schemas.organization import (
    OrganizationCreateRequest,
    OrganizationCreateResponse,
    OrganizationResponse,
)
from app.schemas.team import InviteEmployeeRequest
from app.services.email import build_invitation_accept_url, is_email_configured, send_team_invitation_email
from app.services.membership_access import resolve_membership_organizations
from app.services.organizations import build_organization_response, create_organization
from app.services.team import create_invitation

router = APIRouter()


@router.get("", response_model=list[OrganizationResponse])
async def get_organizations(
    context: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> list[OrganizationResponse]:
    """Return organizations visible to the current membership (branch-scoped when applicable)."""
    organizations = await resolve_membership_organizations(
        db,
        account_id=context.account_id,
        membership=context.membership,
    )
    return [await build_organization_response(db, organization) for organization in organizations]


@router.post("", response_model=OrganizationCreateResponse, status_code=status.HTTP_201_CREATED)
async def add_organization(
    payload: OrganizationCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.ORGANIZATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        organization = await create_organization(
            db,
            account_id=context.account_id,
            payload=payload,
        )
    except ValueError as exc:
        errors = {
            "NO_ACTIVE_SUBSCRIPTION": (
                402,
                {"code": "NO_ACTIVE_SUBSCRIPTION", "message": "يلزم اشتراك نشط لإضافة فرع."},
            ),
            "ORGANIZATION_LIMIT_REACHED": (
                403,
                {
                    "code": "ORGANIZATION_LIMIT_REACHED",
                    "message": "وصلت للحد الأقصى من الفروع في خطتك. راجع الفوترة.",
                },
            ),
            "ORG_USER_LIMIT_TOO_LOW_FOR_ADMIN": (
                400,
                {
                    "code": "ORG_USER_LIMIT_TOO_LOW_FOR_ADMIN",
                    "message": "حد المستخدمين للفرع يجب أن يسمح بمدير فرع واحد على الأقل.",
                },
            ),
        }
        code, detail = errors.get(str(exc), (400, {"code": "ORGANIZATION_CREATE_FAILED", "message": "تعذر إنشاء الفرع."}))
        raise HTTPException(status_code=code, detail=detail) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "ORGANIZATION_SLUG_EXISTS", "message": "معرّف الفرع مستخدم مسبقاً. جرّب اسماً آخر."},
        ) from exc

    branch_admin_invitation_sent = False
    if payload.branch_admin_email:
        if not isinstance(context.membership, Membership):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "BRANCH_ADMIN_INVITE_UNSUPPORTED",
                    "message": "لا يمكن دعوة مدير الفرع من هذا النوع من الجلسات.",
                },
            )
        try:
            invitation, token = await create_invitation(
                db,
                account_id=context.account_id,
                invited_by_user_id=context.user.id,
                actor_membership=context.membership,
                payload=InviteEmployeeRequest(
                    email=payload.branch_admin_email,
                    role=MembershipRole.BRANCH_ADMIN,
                    organization_ids=[organization.id],
                ),
            )
        except ValueError as exc:
            invite_errors = {
                "ALREADY_MEMBER": "هذا البريد عضو في الحساب بالفعل.",
                "USER_LIMIT_REACHED": "وصلت لحد المستخدمين في الخطة.",
                "ORG_USER_LIMIT_REACHED": "حد المستخدمين لهذا الفرع ممتلئ.",
                "NO_ACTIVE_SUBSCRIPTION": "يلزم اشتراك نشط.",
                "FORBIDDEN": "لا تملك صلاحية دعوة مدير الفرع.",
                "OUT_OF_SCOPE": "لا يمكنك دعوة مدير لهذا الفرع.",
                "ORGANIZATION_REQUIRED": "الفرع غير صالح.",
                "INVALID_ORGANIZATION": "الفرع غير صالح.",
            }
            message = invite_errors.get(str(exc), "تعذر إرسال دعوة مدير الفرع.")
            raise HTTPException(
                status_code=400,
                detail={"code": str(exc), "message": message},
            ) from exc

        if is_email_configured():
            account = await db.get(Account, context.account_id)
            branch_admin_invitation_sent = await send_team_invitation_email(
                to=payload.branch_admin_email,
                invite_url=build_invitation_accept_url(token),
                expires_hours=settings.invitation_token_expire_hours,
                account_name=account.name if account else settings.app_name,
                role=MembershipRole.BRANCH_ADMIN,
            )
        else:
            branch_admin_invitation_sent = False
        _ = invitation

    response = await build_organization_response(db, organization)
    return OrganizationCreateResponse(
        **response.model_dump(),
        branch_admin_invitation_sent=branch_admin_invitation_sent,
        branch_admin_email=payload.branch_admin_email,
    )
