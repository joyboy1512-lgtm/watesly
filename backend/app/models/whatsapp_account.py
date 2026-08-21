from enum import StrEnum
from uuid import UUID
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class WhatsAppAccountStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    DISCONNECTED = "disconnected"
    SUSPENDED = "suspended"


class WhatsAppConnectionMethod(StrEnum):
    MANUAL = "manual"
    EMBEDDED = "embedded"


class WhatsAppAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "whatsapp_accounts"
    __table_args__ = (
        UniqueConstraint("phone_number_id", name="uq_whatsapp_accounts_phone_number_id"),
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
    waba_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    phone_number_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    display_phone_number: Mapped[str] = mapped_column(String(40), nullable=False)
    verified_name: Mapped[str | None] = mapped_column(String(160))
    access_token_encrypted: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[WhatsAppAccountStatus] = mapped_column(
        String(30), nullable=False, default=WhatsAppAccountStatus.PENDING
    )
    connection_method: Mapped[str] = mapped_column(
        String(20), nullable=False, default=WhatsAppConnectionMethod.MANUAL
    )
    quality_rating: Mapped[str | None] = mapped_column(String(20))
    messaging_limit_tier: Mapped[str | None] = mapped_column(String(30))
    messaging_limit: Mapped[int | None] = mapped_column(Integer)
    health_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    meta_phone_status: Mapped[str | None] = mapped_column(String(30))
    meta_name_status: Mapped[str | None] = mapped_column(String(30))
    meta_can_send_message: Mapped[str | None] = mapped_column(String(30))
    meta_account_review_status: Mapped[str | None] = mapped_column(String(30))
    meta_status_message: Mapped[str | None] = mapped_column(Text)
    meta_catalog_id: Mapped[str | None] = mapped_column(String(80))
    commerce_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    catalog_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    profile_image_url: Mapped[str | None] = mapped_column(String(2048))
    profile_image_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    catalog_cover_image_url: Mapped[str | None] = mapped_column(String(2048))
    meta_catalog_product_set_id: Mapped[str | None] = mapped_column(String(80))
    catalog_cover_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
