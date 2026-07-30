from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AiAgentSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ai_agent_settings"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    default_mode: Mapped[str] = mapped_column(String(30), nullable=False, default="kb_first")
    tone: Mapped[str] = mapped_column(String(30), nullable=False, default="friendly")
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="ar")
    llm_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    auto_kb_on_inbound: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    llm_system_prompt: Mapped[str | None] = mapped_column(Text)
