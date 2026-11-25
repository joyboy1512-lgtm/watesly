from uuid import UUID

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AiTemplateDraft(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ai_template_drafts"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), index=True, nullable=False
    )
    whatsapp_account_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("whatsapp_accounts.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft", server_default="draft")
    topic: Mapped[str | None] = mapped_column(Text)
    angle: Mapped[str | None] = mapped_column(String(80))
    draft_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    internal_check_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    meta_status: Mapped[str | None] = mapped_column(String(40))
    template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("whatsapp_templates.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text)
