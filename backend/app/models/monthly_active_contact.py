"""Monthly Active Contact (MAC) billing records.

Commercial policy (Watesly):
- MAC counts a unique WhatsApp contact once per billing cycle (calendar month) per account.
- Triggers MAC: inbound customer message OR outbound from Inbox/staff/AI auto-reply.
- Bulk campaigns are billed separately by message count - they do NOT increment MAC.
- Re-contacting the same customer in the same month does NOT create a second MAC.
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
            "cycle_month",
            name="uq_mac_account_contact_cycle",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    contact_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), index=True
    )
    cycle_month: Mapped[str] = mapped_column(String(7), index=True, nullable=False)
    trigger_source: Mapped[str] = mapped_column(String(30), nullable=False)
    first_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)