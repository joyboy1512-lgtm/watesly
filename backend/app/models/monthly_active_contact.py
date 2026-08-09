"""Monthly Active Contact (MAC) billing records.

Commercial policy (Watesly):
- MAC counts a unique contact once per billing period per account (tenant).
- Triggers MAC: inbound, outbound inbox/staff/AI, calls — not broadcast/campaigns.
- Same contact across channels in one period counts once (account-wide dedup).
"""
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class MacTriggerSource(StrEnum):
    INBOUND = "inbound"
    INBOX_OUTBOUND = "inbox_outbound"
    AI_OUTBOUND = "ai_outbound"


class MonthlyActiveContact(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "monthly_active_contacts"
    __table_args__ = (
        UniqueConstraint(
            "account_id",
            "contact_id",
            "billing_period_start",
            name="uq_mac_account_contact_billing_period",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=True
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    contact_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), index=True
    )
    cycle_month: Mapped[str] = mapped_column(String(7), index=True, nullable=False)
    billing_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    billing_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    trigger_source: Mapped[str] = mapped_column(String(30), nullable=False)
    first_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_event_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)