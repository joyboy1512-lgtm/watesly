import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.idempotency_record import IdempotencyRecord, IdempotencyStatus


def fingerprint(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(raw).hexdigest()


async def reserve(db: AsyncSession, *, account_id: UUID, command_name: str, key: str, payload: dict, ttl_hours: int = 24) -> tuple[IdempotencyRecord, bool]:
    fp = fingerprint(payload)
    query = select(IdempotencyRecord).where(IdempotencyRecord.account_id == account_id, IdempotencyRecord.command_name == command_name, IdempotencyRecord.idempotency_key == key)
    current = (await db.execute(query)).scalar_one_or_none()
    if current:
        if current.request_fingerprint != fp:
            raise ValueError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD")
        return current, False

    current = IdempotencyRecord(account_id=account_id, command_name=command_name, idempotency_key=key, request_fingerprint=fp, status=IdempotencyStatus.PROCESSING, expires_at=datetime.now(UTC) + timedelta(hours=ttl_hours))
    try:
        async with db.begin_nested():
            db.add(current)
            await db.flush()
        return current, True
    except IntegrityError:
        current = (await db.execute(query)).scalar_one()
        if current.request_fingerprint != fp:
            raise ValueError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD")
        return current, False


async def complete(db: AsyncSession, record: IdempotencyRecord, response_payload: dict) -> None:
    record.status = IdempotencyStatus.COMPLETED
    record.response_payload = response_payload
    record.error_message = None
    await db.commit()


async def fail(db: AsyncSession, record: IdempotencyRecord, error_message: str) -> None:
    record.status = IdempotencyStatus.FAILED
    record.error_message = error_message[:2000]
    await db.commit()
