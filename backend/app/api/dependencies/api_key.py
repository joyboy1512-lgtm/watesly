from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.api_key import ApiKey
from app.services.api_key_auth import hash_api_key, touch_api_key

api_key_bearer = HTTPBearer(auto_error=False)

API_RATE_LIMIT = 100
API_RATE_WINDOW = 60

SCOPE_ALIASES = {
    "read": {"contacts:read", "campaigns:read", "crm:read", "conversations:read"},
    "write": {"contacts:write", "messages:send", "crm:write", "campaigns:write"},
}


@dataclass
class ApiKeyContext:
    api_key: ApiKey
    account_id: UUID
    scopes: set[str]

    def has_scope(self, scope: str) -> bool:
        if scope in self.scopes:
            return True
        if "read" in self.scopes and scope.endswith(":read"):
            return True
        if "write" in self.scopes and (scope.endswith(":write") or scope == "messages:send"):
            return True
        for alias, expanded in SCOPE_ALIASES.items():
            if alias in self.scopes and scope in expanded:
                return True
        return False


async def get_api_key_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(api_key_bearer),
    db: AsyncSession = Depends(get_db),
) -> ApiKeyContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key. Use Authorization: Bearer mw_...",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raw = credentials.credentials.strip()
    if not raw.startswith("mw_"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key format")

    prefix = raw[:8]
    key_hash = hash_api_key(raw)
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_prefix == prefix,
            ApiKey.key_hash == key_hash,
            ApiKey.revoked_at.is_(None),
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or revoked API key")

    await enforce_rate_limit(
        request,
        bucket="external_api",
        limit=API_RATE_LIMIT,
        window_seconds=API_RATE_WINDOW,
        identity=str(item.id),
    )
    await touch_api_key(db, api_key=item)

    scopes = set(item.scopes or [])
    return ApiKeyContext(api_key=item, account_id=item.account_id, scopes=scopes)


def require_api_scope(scope: str):
    async def _dep(context: ApiKeyContext = Depends(get_api_key_context)) -> ApiKeyContext:
        if not context.has_scope(scope):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key missing scope: {scope}",
            )
        return context

    return _dep
