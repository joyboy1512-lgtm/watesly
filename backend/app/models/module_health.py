from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ModuleHealthStatus(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    DOWN = "down"
    STALE = "stale"
    DRAINING = "draining"
    UNKNOWN = "unknown"


class ModuleHealth(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "module_health"
    __table_args__ = (
        UniqueConstraint("module_name", "instance_id", name="uq_module_health_name_instance"),
    )

    module_name: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    instance_id: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    status: Mapped[ModuleHealthStatus] = mapped_column(
        String(30), index=True, nullable=False, default=ModuleHealthStatus.UNKNOWN
    )
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
