from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.account import AccountStatus
from app.models.plan import PlanStatus
from app.models.subscription import BillingCycle, SubscriptionStatus


class AdminAccountResponse(BaseModel):
    id: UUID
    name: str
    status: AccountStatus
    created_at: datetime
    plan_code: str | None = None
    subscription_status: str | None = None


class AdminAccountUpdateRequest(BaseModel):
    status: AccountStatus


class AdminPlanCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=100)
    monthly_price: float = Field(ge=0)
    yearly_price: float = Field(ge=0)
    max_users: int = Field(ge=1)
    max_organizations: int = Field(ge=1)
    max_channels: int = Field(ge=1)
    included_mac: int = Field(ge=0, default=1000)
    over_mac_price_per_100: float = Field(ge=0, default=12)
    trial_days: int = Field(ge=0, le=365)
    allow_multi_organization: bool = False
    status: PlanStatus = PlanStatus.ACTIVE


class AdminPlanUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    monthly_price: float | None = Field(default=None, ge=0)
    yearly_price: float | None = Field(default=None, ge=0)
    max_users: int | None = Field(default=None, ge=1)
    max_organizations: int | None = Field(default=None, ge=1)
    max_channels: int | None = Field(default=None, ge=1)
    included_mac: int | None = Field(default=None, ge=0)
    over_mac_price_per_100: float | None = Field(default=None, ge=0)
    trial_days: int | None = Field(default=None, ge=0, le=365)
    allow_multi_organization: bool | None = None
    status: PlanStatus | None = None


class AdminPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    monthly_price: float
    yearly_price: float
    max_users: int
    max_organizations: int
    max_channels: int
    included_mac: int
    over_mac_price_per_100: float
    trial_days: int
    allow_multi_organization: bool
    status: PlanStatus


class AdminSubscriptionUpdateRequest(BaseModel):
    plan_id: UUID
    status: SubscriptionStatus
    billing_cycle: BillingCycle
    ends_at: datetime


class AdminSubscriptionResponse(BaseModel):
    id: UUID
    account_id: UUID
    plan_id: UUID
    plan_code: str
    status: SubscriptionStatus
    billing_cycle: BillingCycle
    starts_at: datetime
    ends_at: datetime
