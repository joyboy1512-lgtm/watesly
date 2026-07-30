from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, role_has_permission
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.account import Account, AccountStatus
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.support_access_grant import SupportAccessGrant, SupportAccessStatus
from app.models.user import User, UserStatus

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


@dataclass
class AuthContext:
    user: User
    membership: Membership
    account: Account
    account_id: UUID


_BLOCKED_ACCOUNT_STATUSES = {
    AccountStatus.SUSPENDED,
    AccountStatus.CANCELLED,
    AccountStatus.SCHEDULED_FOR_DELETION,
    AccountStatus.CLOSED,
}

_WRITE_RESTRICTED_STATUSES = {AccountStatus.PAST_DUE, AccountStatus.RESTRICTED}


async def get_auth_context(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthContext:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        if payload.get("type") != "access":
            raise credentials_error
        user_id = UUID(payload["sub"])
        account_id = UUID(payload["account_id"])
        session_id = UUID(payload["sid"])
        password_version = int(payload.get("pwd", 0))
    except (jwt.InvalidTokenError, KeyError, ValueError) as exc:
        raise credentials_error from exc

    user = await db.get(User, user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise credentials_error
    current_password_version = int(user.password_changed_at.timestamp()) if user.password_changed_at else 0
    if password_version != current_password_version:
        raise credentials_error
    from app.models.refresh_session import RefreshSession
    session = await db.get(RefreshSession, session_id)
    if session is None or session.user_id != user_id or session.account_id != account_id or session.revoked_at is not None or session.expires_at <= datetime.now(UTC):
        raise credentials_error

    account = await db.get(Account, account_id)
    if account is None or account.status in _BLOCKED_ACCOUNT_STATUSES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is not active")

    result = await db.execute(
        select(Membership).where(
            Membership.user_id == user_id,
            Membership.account_id == account_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None or membership.status != MembershipStatus.ACTIVE:
        if not user.is_super_admin:
            raise credentials_error
        now=datetime.now(UTC)
        grant=(await db.execute(select(SupportAccessGrant).where(SupportAccessGrant.account_id==account_id,SupportAccessGrant.support_user_id==user_id,SupportAccessGrant.status==SupportAccessStatus.ACTIVE,SupportAccessGrant.starts_at<=now,SupportAccessGrant.expires_at>now,SupportAccessGrant.revoked_at.is_(None)))).scalars().first()
        if grant is None:
            raise credentials_error
        from types import SimpleNamespace
        membership=SimpleNamespace(id=user.id,user_id=user.id,account_id=account_id,role=MembershipRole.ADMIN,status=MembershipStatus.ACTIVE)

    return AuthContext(user=user, membership=membership, account=account, account_id=account_id)


async def get_current_user(context: AuthContext = Depends(get_auth_context)) -> User:
    return context.user


async def _super_admin_has_support_access(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_id: UUID,
    permissions: tuple[Permission, ...],
) -> bool:
    if all(p in {Permission.OPERATIONS_VIEW, Permission.OPERATIONS_MANAGE} for p in permissions):
        return True
    now = datetime.now(UTC)
    result = await db.execute(
        select(SupportAccessGrant).where(
            SupportAccessGrant.account_id == account_id,
            SupportAccessGrant.support_user_id == user_id,
            SupportAccessGrant.status == SupportAccessStatus.ACTIVE,
            SupportAccessGrant.starts_at <= now,
            SupportAccessGrant.expires_at > now,
            SupportAccessGrant.revoked_at.is_(None),
        ).order_by(SupportAccessGrant.expires_at.desc())
    )
    grant = result.scalars().first()
    if grant is None:
        return False
    allowed_scopes = {item.strip() for item in grant.scope.split(",") if item.strip()}
    return "*" in allowed_scopes or all(p.value in allowed_scopes for p in permissions)


def require_roles(*allowed_roles: MembershipRole):
    async def dependency(context: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if context.membership.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="You do not have permission to perform this action")
        return context
    return dependency


def require_permissions(*permissions: Permission, write: bool = False):
    async def dependency(
        context: AuthContext = Depends(get_auth_context),
        db: AsyncSession = Depends(get_db),
    ) -> AuthContext:
        if write and context.account.status in _WRITE_RESTRICTED_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"code": "ACCOUNT_RESTRICTED", "status": context.account.status.value},
            )
        if context.user.is_super_admin and not isinstance(context.membership, Membership):
            if not await _super_admin_has_support_access(
                db,
                user_id=context.user.id,
                account_id=context.account_id,
                permissions=permissions,
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"code": "SUPPORT_ACCESS_REQUIRED"},
                )
            return context
        missing = [p.value for p in permissions if not role_has_permission(context.membership.role, p)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "MISSING_PERMISSION", "permissions": missing},
            )
        return context
    return dependency
