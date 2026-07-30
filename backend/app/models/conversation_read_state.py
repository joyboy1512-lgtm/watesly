from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ConversationReadState(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "conversation_read_states"
    __table_args__ = (
        UniqueConstraint("conversation_id", "membership_id", name="uq_conversation_read_states_conv_member"),
    )

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    membership_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="CASCADE"), index=True
    )
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
