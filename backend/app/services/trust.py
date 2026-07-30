from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.data_encryption import generate_account_data_key, wrap_account_data_key
from app.models.account_data_key import AccountDataKey
from app.models.audit_log import AuditLog
from app.models.support_access_grant import (
    SupportAccessGrant,
    SupportAccessStatus,
)
from app.schemas.trust import SupportAccessCreateRequest


async def append_audit_log(
    db: AsyncSession,
    *,
    account_id: UUID,
    actor_user_id: UUID | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict | None = None,
) -> AuditLog:
    item = AuditLog(
        account_id=account_id,
        actor_user_id=actor_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent,
        details=metadata,
    )
    db.add(item)
    await db.flush()
    return item


async def ensure_account_data_key(
    db: AsyncSession,
    *,
    account_id: UUID,
    actor_user_id: UUID,
) -> AccountDataKey:
    result = await db.execute(
        select(AccountDataKey).where(AccountDataKey.account_id == account_id)
    )
    item = result.scalar_one_or_none()
    if item is not None:
        return item

    raw_key = generate_account_data_key()
    item = AccountDataKey(
        account_id=account_id,
        encrypted_key=wrap_account_data_key(raw_key),
        key_version=1,
    )
    db.add(item)
    await append_audit_log(
        db,
        account_id=account_id,
        actor_user_id=actor_user_id,
        action="encryption_key_created",
        resource_type="account_data_key",
        resource_id=str(account_id),
    )
    await db.commit()
    await db.refresh(item)
    return item


async def create_support_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    actor_user_id: UUID,
    payload: SupportAccessCreateRequest,
    ip_address: str | None,
    user_agent: str | None,
) -> SupportAccessGrant:
    max_hours = min(settings.support_access_max_hours, 24)
    if payload.duration_hours > max_hours:
        raise ValueError("DURATION_TOO_LONG")

    now = datetime.now(UTC)
    item = SupportAccessGrant(
        account_id=account_id,
        granted_by_user_id=actor_user_id,
        support_user_id=payload.support_user_id,
        reason=payload.reason,
        scope=payload.scope,
        starts_at=now,
        expires_at=now + timedelta(hours=payload.duration_hours),
        status=SupportAccessStatus.ACTIVE,
    )
    db.add(item)
    await db.flush()
    await append_audit_log(
        db,
        account_id=account_id,
        actor_user_id=actor_user_id,
        action="support_access_granted",
        resource_type="support_access_grant",
        resource_id=str(item.id),
        ip_address=ip_address,
        user_agent=user_agent,
        metadata={
            "scope": payload.scope,
            "duration_hours": payload.duration_hours,
            "support_user_id": str(payload.support_user_id) if payload.support_user_id else None,
        },
    )
    await db.commit()
    await db.refresh(item)
    return item


async def revoke_support_access(
    db: AsyncSession,
    *,
    account_id: UUID,
    actor_user_id: UUID,
    grant_id: UUID,
    ip_address: str | None,
    user_agent: str | None,
) -> SupportAccessGrant:
    item = await db.get(SupportAccessGrant, grant_id)
    if item is None or item.account_id != account_id:
        raise ValueError("GRANT_NOT_FOUND")
    item.status = SupportAccessStatus.REVOKED
    item.revoked_at = datetime.now(UTC)
    await append_audit_log(
        db,
        account_id=account_id,
        actor_user_id=actor_user_id,
        action="support_access_revoked",
        resource_type="support_access_grant",
        resource_id=str(item.id),
        ip_address=ip_address,
        user_agent=user_agent,
    )
    await db.commit()
    await db.refresh(item)
    return item


async def list_support_access(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> list[SupportAccessGrant]:
    result = await db.execute(
        select(SupportAccessGrant)
        .where(SupportAccessGrant.account_id == account_id)
        .order_by(SupportAccessGrant.created_at.desc())
    )
    return list(result.scalars().all())


async def list_audit_logs(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.account_id == account_id)
        .order_by(AuditLog.created_at.desc())
        .limit(500)
    )
    return list(result.scalars().all())


async def get_trust_status(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> dict:
    key_result = await db.execute(
        select(AccountDataKey).where(AccountDataKey.account_id == account_id)
    )
    key = key_result.scalar_one_or_none()

    now = datetime.now(UTC)
    active_grants = await db.scalar(
        select(func.count(SupportAccessGrant.id)).where(
            SupportAccessGrant.account_id == account_id,
            SupportAccessGrant.status == SupportAccessStatus.ACTIVE,
            SupportAccessGrant.expires_at > now,
            SupportAccessGrant.revoked_at.is_(None),
        )
    )

    last_audit = await db.scalar(
        select(func.max(AuditLog.created_at)).where(AuditLog.account_id == account_id)
    )

    return {
        "encryption_enabled": key is not None,
        "key_version": key.key_version if key else None,
        "active_support_grants": int(active_grants or 0),
        "last_audit_event_at": last_audit,
    }
