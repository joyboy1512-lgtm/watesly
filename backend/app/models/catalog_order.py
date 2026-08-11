from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.contact import Contact


class CatalogOrderStatus(StrEnum):
    RECEIVED = "received"
    REVIEWED = "reviewed"
    INVOICED = "invoiced"
    CANCELLED = "cancelled"


class CatalogOrder(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "catalog_orders"
    __table_args__ = (UniqueConstraint("message_id", name="uq_catalog_orders_message_id"),)

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    contact_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), index=True
    )
    message_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    deal_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("deals.id", ondelete="SET NULL"), index=True
    )
    order_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    meta_catalog_id: Mapped[str | None] = mapped_column(String(80))
    customer_note: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="KWD")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=CatalogOrderStatus.RECEIVED)
    line_items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    contact: Mapped["Contact"] = relationship("Contact")
