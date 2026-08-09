from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SubscriptionResponse(BaseModel):
    plan_id: UUID
    plan_code: str
    plan_name: str
    status: str
    billing_cycle: str
    starts_at: datetime
    ends_at: datetime
    max_users: int
    max_organizations: int
    max_channels: int
    included_mac: int = 0
    over_mac_price_per_100: float = 0
    included_mac_override: int | None = None
    over_mac_price_per_100_override: float | None = None
    allow_multi_organization: bool
    cycle_month: str | None = None
    mac_count: int = 0
    mac_remaining: int = 0
    is_over_mac: bool = False
    over_mac_count: int = 0
    over_mac_blocks: int = 0
    estimated_over_mac_charge: float = 0
    billing_period_start: datetime | None = None
    billing_period_end: datetime | None = None


class BillingProviderSettingsResponse(BaseModel):
    starts_at: datetime
    ends_at: datetime
    billing_cycle: str
    billing_period_start: datetime
    billing_period_end: datetime
    included_mac: int
    included_mac_override: int | None = None
    over_mac_price_per_100: float
    over_mac_price_per_100_override: float | None = None
    plan_name: str
    plan_included_mac: int
    plan_over_mac_price_per_100: float


class BillingProviderSettingsUpdate(BaseModel):
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    included_mac_override: int | None = None
    over_mac_price_per_100_override: float | None = None


class ChannelBillingUpdateRequest(BaseModel):
    over_mac_price_per_100: float | None = None


class PublicPlanResponse(BaseModel):
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
