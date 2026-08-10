from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, get_auth_context, get_current_user
from app.core.permissions import get_effective_permissions, permissions_for_response, role_permissions
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.user import User
from app.models.membership import Membership
from app.schemas.auth import AccountChoice, AccountChoicesResponse, CurrentUserResponse, LoginRequest, LogoutRequest, RefreshRequest, RegisterRequest, RegistrationResponse, TokenResponse
from app.services.auth import authenticate_user, issue_token_pair, list_active_memberships, register_owner, revoke_refresh_token, rotate_refresh_token

router = APIRouter()


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        domain=settings.refresh_cookie_domain,
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        domain=settings.refresh_cookie_domain,
        path="/api/v1/auth",
    )


@router.post("/register", response_model=RegistrationResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)) -> RegistrationResponse:
    try:
        user, account, organization, access_token, refresh_token = await register_owner(db, payload)
    except ValueError as exc:
        if str(exc) == "EMAIL_ALREADY_REGISTERED":
            raise HTTPException(status_code=409, detail="Email is already registered") from exc
        raise
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Account data conflicts with existing data") from exc
    _set_refresh_cookie(response, refresh_token)
    return RegistrationResponse(access_token=access_token, expires_in=settings.access_token_expire_minutes * 60, user_id=user.id, account_id=account.id, organization_id=organization.id)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    await enforce_rate_limit(request,bucket="login",limit=10,window_seconds=60,identity=f"{request.client.host if request.client else 'unknown'}:{payload.email}")
    try:
        authenticated = await authenticate_user(db, payload)
    except ValueError as exc:
        if str(exc) == "ACCOUNT_NOT_AVAILABLE":
            raise HTTPException(status_code=403, detail="Account is not available") from exc
        raise
    if authenticated is None:
        raise HTTPException(status_code=401, detail="Incorrect email or password", headers={"WWW-Authenticate": "Bearer"})
    user, membership_or_choices, access_token, refresh_token = authenticated
    if access_token is None:
        from app.models.account import Account
        choices=[]
        for membership in membership_or_choices:
            account=await db.get(Account,membership.account_id)
            choices.append({"account_id":str(membership.account_id),"account_name":account.name if account else "Unknown","role":membership.role.value})
        raise HTTPException(status_code=409,detail={"code":"ACCOUNT_SELECTION_REQUIRED","accounts":choices})
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token, expires_in=settings.access_token_expire_minutes * 60)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, response: Response, request: Request, cookie_token: str | None = Cookie(default=None, alias=settings.refresh_cookie_name), db: AsyncSession = Depends(get_db)) -> TokenResponse:
    await enforce_rate_limit(request,bucket="refresh",limit=30,window_seconds=60)
    token = payload.refresh_token or cookie_token
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token is missing")
    tokens = await rotate_refresh_token(db, token)
    if tokens is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    access_token, refresh_token = tokens
    _set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token, expires_in=settings.access_token_expire_minutes * 60)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: LogoutRequest, response: Response, cookie_token: str | None = Cookie(default=None, alias=settings.refresh_cookie_name), db: AsyncSession = Depends(get_db)) -> None:
    token = payload.refresh_token or cookie_token
    if token:
        await revoke_refresh_token(db, token)
    _clear_refresh_cookie(response)


@router.get("/me", response_model=CurrentUserResponse)
async def me(
    context: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
) -> CurrentUserResponse:
    membership = context.membership
    role = membership.role.value if hasattr(membership, "role") else None
    permissions = (
        permissions_for_response(membership)
        if isinstance(membership, Membership)
        else sorted(item.value for item in role_permissions(membership.role))
    )
    organizations: list = []
    branch_name: str | None = None
    if isinstance(membership, Membership):
        from app.services.membership_access import (
            branch_display_name,
            resolve_membership_organizations,
        )

        org_rows = await resolve_membership_organizations(
            db, account_id=context.account_id, membership=membership
        )
        organizations = [
            {"id": item.id, "name": item.name}
            for item in org_rows
        ]
        branch_name = branch_display_name(org_rows)
    return CurrentUserResponse(
        id=context.user.id,
        email=context.user.email,
        full_name=context.user.full_name,
        preferred_language=context.user.preferred_language,
        is_super_admin=context.user.is_super_admin,
        role=role,
        permissions=permissions,
        account_name=context.account.name if context.account else None,
        branch_name=branch_name,
        organizations=organizations,
    )


@router.post("/switch-account/{account_id}", response_model=TokenResponse)
async def switch_account(account_id, response: Response, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> TokenResponse:
    from uuid import UUID
    target_id=UUID(str(account_id))
    memberships=await list_active_memberships(db,current_user.id)
    membership=next((m for m in memberships if m.account_id==target_id),None)
    if membership is None and current_user.is_super_admin:
        from datetime import UTC, datetime
        from sqlalchemy import select
        from app.models.support_access_grant import SupportAccessGrant, SupportAccessStatus
        grant=(await db.execute(select(SupportAccessGrant).where(SupportAccessGrant.account_id==target_id,SupportAccessGrant.support_user_id==current_user.id,SupportAccessGrant.status==SupportAccessStatus.ACTIVE,SupportAccessGrant.starts_at<=datetime.now(UTC),SupportAccessGrant.expires_at>datetime.now(UTC),SupportAccessGrant.revoked_at.is_(None)))).scalars().first()
        if grant is None: raise HTTPException(status_code=403,detail="Active support access grant is required")
    elif membership is None:
        raise HTTPException(status_code=403,detail="Account is not available")
    access,refresh=await issue_token_pair(db,user=current_user,account_id=target_id)
    _set_refresh_cookie(response,refresh)
    return TokenResponse(access_token=access,expires_in=settings.access_token_expire_minutes*60)
