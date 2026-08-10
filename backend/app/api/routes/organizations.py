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
            "NO_ACTIVE_SUBSCRIPTION": (402, "An active subscription is required"),
            "ORGANIZATION_LIMIT_REACHED": (403, "Organization limit reached for this plan"),
            "MULTI_ORGANIZATION_NOT_ALLOWED": (403, "Multi-organization is not enabled for this plan"),
        }
        code, detail = errors.get(str(exc), (400, "Unable to create organization"))
        raise HTTPException(status_code=code, detail=detail) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Organization slug already exists") from exc
