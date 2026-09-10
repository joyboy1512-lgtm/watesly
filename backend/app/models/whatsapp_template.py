from enum import StrEnum
from uuid import UUID
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TemplateStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAUSED = "paused"
    DISABLED = "disabled"


class TemplateCategory(StrEnum):
    MARKETING = "marketing"
    UTILITY = "utility"
    AUTHENTICATION = "authentication"


class WhatsAppTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "whatsapp_templates"
    __table_args__ = (
        UniqueConstraint(
            "whatsapp_account_id", "name", "language",
            name="uq_whatsapp_templates_account_name_language",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    whatsapp_account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("whatsapp_accounts.id", ondelete="CASCADE"),
        index=True,
    )
    meta_template_id: Mapped[str | None] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    language: Mapped[str] = mapped_column(String(20), nullable=False)
    category: Mapped[TemplateCategory] = mapped_column(String(30), nullable=False)
    status: Mapped[TemplateStatus] = mapped_column(
        String(30), nullable=False, default=TemplateStatus.DRAFT
    )
    body_text: Mapped[str | None] = mapped_column(Text)
    components: Mapped[list | None] = mapped_column(JSON)
    meta_status_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
