from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class WebhookEventStatus(StrEnum):
    RECEIVED = "received"
    PROCESSED = "processed"
    FAILED = "failed"
    IGNORED = "ignored"


class WebhookEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "webhook_events"

    provider: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    external_event_key: Mapped[str | None] = mapped_column(String(255), index=True)
    account_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), index=True
    )
    channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[WebhookEventStatus] = mapped_column(
        String(30), nullable=False, default=WebhookEventStatus.RECEIVED
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
