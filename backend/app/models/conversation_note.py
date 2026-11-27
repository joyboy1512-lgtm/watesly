from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ConversationNote(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "conversation_notes"

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[list | None] = mapped_column(JSONB)
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # note = sidebar note; whisper = in-chat coaching visible only to staff (never WhatsApp)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="note", server_default="note")
