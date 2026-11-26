from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Deal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "deals"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="SET NULL")
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), index=True
    )
    assigned_membership_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    stage: Mapped[str] = mapped_column(String(40), nullable=False, default="lead")
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="KWD")
    pipeline: Mapped[str] = mapped_column(String(80), nullable=False, default="default")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    probability: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    expected_close_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    loss_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
    loss_reason_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_step: Mapped[str | None] = mapped_column(String(240), nullable=True)
    next_step_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    conversation_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )


class DealActivity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "deal_activities"

    deal_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("deals.id", ondelete="CASCADE"), index=True
    )
    activity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
