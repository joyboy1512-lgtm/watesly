from uuid import UUID

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AiActivityEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ai_activity_events"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), index=True, nullable=True
    )
    conversation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="live")
    outcome: Mapped[str] = mapped_column(String(40), nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(80))
    reason_text: Mapped[str | None] = mapped_column(Text)
    query_text: Mapped[str | None] = mapped_column(Text)
    suggestion: Mapped[str | None] = mapped_column(Text)
    engine: Mapped[str | None] = mapped_column(String(80))
    meta_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
