from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CampaignRecipientStatus(StrEnum):
    PENDING = "pending"
    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"
    SKIPPED = "skipped"


class CampaignRecipient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "campaign_recipients"
    __table_args__ = (
        UniqueConstraint("campaign_id", "contact_id", name="uq_campaign_recipients_campaign_contact"),
    )

    campaign_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    contact_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[CampaignRecipientStatus] = mapped_column(
        String(30), nullable=False, default=CampaignRecipientStatus.PENDING
    )
    template_parameters: Mapped[list | None] = mapped_column(JSON)
    external_message_id: Mapped[str | None] = mapped_column(String(255), index=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    delivery_key: Mapped[str | None] = mapped_column(String(160), unique=True, index=True)
    sending_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
