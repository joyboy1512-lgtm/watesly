from enum import StrEnum

from sqlalchemy import Boolean, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PlanStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class Plan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    monthly_price: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    yearly_price: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    max_users: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    max_organizations: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    included_mac: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    over_mac_price_per_100: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=12)
    trial_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    allow_multi_organization: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[PlanStatus] = mapped_column(String(20), nullable=False, default=PlanStatus.ACTIVE)
