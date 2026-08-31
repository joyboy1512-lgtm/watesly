from enum import StrEnum
from uuid import UUID
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class InstagramAccountStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    DISCONNECTED = "disconnected"
    SUSPENDED = "suspended"


class InstagramAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "instagram_accounts"
    __table_args__ = (
        UniqueConstraint("ig_user_id", name="uq_instagram_accounts_ig_user_id"),
        UniqueConstraint("page_id", name="uq_instagram_accounts_page_id"),
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
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("channels.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    page_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    ig_user_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(160))
    page_name: Mapped[str | None] = mapped_column(String(160))
    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[InstagramAccountStatus] = mapped_column(
        String(30), nullable=False, default=InstagramAccountStatus.PENDING
    )
    webhook_subscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta_status_message: Mapped[str | None] = mapped_column(Text)
