from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class ConversationTag(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "conversation_tags"
    __table_args__ = (
        UniqueConstraint("conversation_id", "tag_id", name="uq_conversation_tags_conversation_tag"),
    )

    conversation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    tag_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), index=True
    )
