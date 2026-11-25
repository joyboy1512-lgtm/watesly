from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
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
    agent_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    local_engine_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    llm_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    auto_kb_on_inbound: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_reply_on_inbound: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    llm_system_prompt: Mapped[str | None] = mapped_column(Text)
    llm_api_key_encrypted: Mapped[str | None] = mapped_column(Text)
    llm_api_base_url: Mapped[str | None] = mapped_column(String(512))
    llm_model: Mapped[str | None] = mapped_column(String(120))
    llm_image_model: Mapped[str | None] = mapped_column(String(120))
    auto_reply_outside_hours: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    business_hours_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    outside_hours_message: Mapped[str | None] = mapped_column(Text)
    welcome_message_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    welcome_message: Mapped[str | None] = mapped_column(Text)
