from enum import StrEnum
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AutomationStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class AutomationTriggerType(StrEnum):
    MESSAGE_RECEIVED = "message_received"
    CONVERSATION_CREATED = "conversation_created"
    CONVERSATION_ASSIGNED = "conversation_assigned"
    TAG_ADDED = "tag_added"
    WEBHOOK = "webhook"
    MANUAL = "manual"


class Automation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "automations"
    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_automations_account_name"),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[AutomationStatus] = mapped_column(
        String(30), nullable=False, default=AutomationStatus.DRAFT
    )
    trigger_type: Mapped[AutomationTriggerType] = mapped_column(
        String(50), nullable=False
    )
    trigger_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    graph: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_template: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
