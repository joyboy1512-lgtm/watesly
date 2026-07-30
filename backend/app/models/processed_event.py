from datetime import datetime
from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from uuid import UUID
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

class ProcessedEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "processed_events"
    event_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), unique=True, index=True, nullable=False)
    consumer: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
