from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.trust import (
    AuditLogResponse,
    SupportAccessCreateRequest,
    SupportAccessResponse,
    TrustStatusResponse,
)
from app.services.trust import (
    create_support_access,
    ensure_account_data_key,
    get_trust_status,
    list_audit_logs,
    list_support_access,
    revoke_support_access,
)

router = APIRouter()


@router.get("/status", response_model=TrustStatusResponse)
async def status(
    context: AuthContext = Depends(require_permissions(Permission.TRUST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_trust_status(db, account_id=context.account_id)


@router.post("/encryption/enable", response_model=TrustStatusResponse)
async def enable_encryption(
    context: AuthContext = Depends(require_permissions(Permission.TRUST_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    await ensure_account_data_key(
        db,
        account_id=context.account_id,
        actor_user_id=context.user.id,
    )
    return await get_trust_status(db, account_id=context.account_id)


@router.get("/support-access", response_model=list[SupportAccessResponse])
async def get_support_access(
    context: AuthContext = Depends(require_permissions(Permission.TRUST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_support_access(db, account_id=context.account_id)


@router.post("/support-access", response_model=SupportAccessResponse)
async def grant_support_access(
    payload: SupportAccessCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_permissions(Permission.TRUST_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_support_access(
            db,
            account_id=context.account_id,
            actor_user_id=context.user.id,
            payload=payload,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Support access duration is too long") from exc


@router.post("/support-access/{grant_id}/revoke", response_model=SupportAccessResponse)
async def revoke_support(
    grant_id: UUID,
    request: Request,
    context: AuthContext = Depends(require_permissions(Permission.TRUST_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await revoke_support_access(
            db,
            account_id=context.account_id,
            actor_user_id=context.user.id,
            grant_id=grant_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Support access grant not found") from exc


@router.get("/audit-logs", response_model=list[AuditLogResponse])
async def audit_logs(
    context: AuthContext = Depends(require_permissions(Permission.TRUST_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await list_audit_logs(db, account_id=context.account_id)
