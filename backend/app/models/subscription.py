from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.plan import Plan


class SubscriptionStatus(StrEnum):
    TRIAL = "trial"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class BillingCycle(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"
    TRIAL = "trial"


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    account_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    plan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("plans.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        String(20), nullable=False, default=SubscriptionStatus.TRIAL
    )
    billing_cycle: Mapped[BillingCycle] = mapped_column(
        String(20), nullable=False, default=BillingCycle.TRIAL
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    included_mac_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    over_mac_price_per_100_override: Mapped[float | None] = mapped_column(
        Numeric(12, 3), nullable=True
    )

    plan: Mapped["Plan"] = relationship()
