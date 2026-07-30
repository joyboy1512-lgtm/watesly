from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class AgentPresence(TimestampMixin, Base):
    __tablename__ = "agent_presence"

    membership_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="offline")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
