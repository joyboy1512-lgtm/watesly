from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AiAgentChannelSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Per-channel overrides. NULL column = inherit account AiAgentSettings."""

    __tablename__ = "ai_agent_channel_settings"
    __table_args__ = (
        UniqueConstraint("account_id", "channel_id", name="uq_ai_agent_channel_settings_account_channel"),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), index=True, nullable=False
    )
    agent_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    local_engine_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    llm_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    auto_kb_on_inbound: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    auto_reply_on_inbound: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    default_mode: Mapped[str | None] = mapped_column(String(30), nullable=True)
    tone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    language: Mapped[str | None] = mapped_column(String(10), nullable=True)
    auto_reply_outside_hours: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    business_hours_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    outside_hours_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    welcome_message_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    welcome_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    escalation_keywords: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    clarify_max_rounds: Mapped[int | None] = mapped_column(Integer, nullable=True)
