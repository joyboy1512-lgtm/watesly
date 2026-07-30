from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AutomationStepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class AutomationRunStep(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "automation_run_steps"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("automation_runs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    node_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    node_type: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[AutomationStepStatus] = mapped_column(
        String(30), nullable=False, default=AutomationStepStatus.PENDING
    )
    input_data: Mapped[dict | None] = mapped_column(JSON)
    output_data: Mapped[dict | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
