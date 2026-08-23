from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, get_auth_context, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.organization import OrganizationCreateRequest, OrganizationResponse
from app.services.organizations import create_organization
from app.services.membership_access import resolve_membership_organizations

router = APIRouter()


@router.get("", response_model=list[OrganizationResponse])
async def get_organizations(
    context: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> list:
    """Return organizations visible to the current membership (branch-scoped when applicable)."""
    return await resolve_membership_organizations(
        db,
        account_id=context.account_id,
        membership=context.membership,
    )


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def add_organization(
    payload: OrganizationCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.ORGANIZATIONS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_organization(db, account_id=context.account_id, payload=payload)
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
                    "message": "وصلت للحد الأقصى من الفروع في خطتك. راجع الفوترة للترقية.",
                },
            ),
            "MULTI_ORGANIZATION_NOT_ALLOWED": (
                403,
                {
                    "code": "MULTI_ORGANIZATION_NOT_ALLOWED",
                    "message": "خطتك لا تدعم أكثر من فرع واحد. راجع الفوترة لتفعيل تعدد الفروع.",
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
