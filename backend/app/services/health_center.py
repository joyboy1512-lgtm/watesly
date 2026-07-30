from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_health import ModuleHealth, ModuleHealthStatus


async def heartbeat(
    db: AsyncSession,
    *,
    module_name: str,
    instance_id: str,
    status: ModuleHealthStatus,
    details: dict | None = None,
) -> ModuleHealth:
    result = await db.execute(
        select(ModuleHealth).where(
            ModuleHealth.module_name == module_name,
            ModuleHealth.instance_id == instance_id,
        )
    )
    item = result.scalar_one_or_none()
    now = datetime.now(UTC)
    if item is None:
        item = ModuleHealth(
            module_name=module_name,
            instance_id=instance_id,
            status=status,
            details=details or {},
            heartbeat_at=now,
        )
        db.add(item)
    else:
        item.status = status
        item.details = details or {}
        item.heartbeat_at = now
    await db.commit()
    await db.refresh(item)
    return item


async def list_module_health(db: AsyncSession, *, stale_seconds: int = 90, down_seconds: int = 240) -> list[ModuleHealth]:
    result = await db.execute(
        select(ModuleHealth).order_by(ModuleHealth.module_name.asc())
    )
    items = list(result.scalars().all())
    now = datetime.now(UTC)
    stale_before = now - timedelta(seconds=stale_seconds)
    down_before = now - timedelta(seconds=down_seconds)
    for item in items:
        if item.status == ModuleHealthStatus.DRAINING:
            continue
        if item.heartbeat_at < down_before:
            item.status = ModuleHealthStatus.DOWN
        elif item.heartbeat_at < stale_before:
            item.status = ModuleHealthStatus.STALE
    return items
