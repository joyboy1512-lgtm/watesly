from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Enum, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.organization import Organization


class AccountStatus(StrEnum):
    TRIAL = "trial"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    RESTRICTED = "restricted"
    SUSPENDED = "suspended"
    CANCELLED = "cancelled"
    SCHEDULED_FOR_DELETION = "scheduled_for_deletion"
    CLOSED = "closed"


class Account(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "accounts"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[AccountStatus] = mapped_column(
        Enum(AccountStatus, name="account_status"),
        default=AccountStatus.TRIAL,
        nullable=False,
    )
    feature_flags: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

    organizations: Mapped[list["Organization"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
    )
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
    )
