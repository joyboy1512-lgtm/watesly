from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resource_record import ResourceRecord


async def register_resource(
    db: AsyncSession,
    *,
    account_id: UUID,
    resource_type: str,
    resource_id: str,
    owner_user_id: UUID | None = None,
    metadata: dict | None = None,
) -> ResourceRecord:
    result = await db.execute(
        select(ResourceRecord).where(
            ResourceRecord.account_id == account_id,
            ResourceRecord.resource_type == resource_type,
            ResourceRecord.resource_id == resource_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        item = ResourceRecord(
            account_id=account_id,
            resource_type=resource_type,
            resource_id=resource_id,
            owner_user_id=owner_user_id,
            details=metadata or {},
        )
        db.add(item)
    else:
        item.version += 1
        item.owner_user_id = owner_user_id or item.owner_user_id
        if metadata:
            item.details = {**item.details, **metadata}

    await db.flush()
    return item
