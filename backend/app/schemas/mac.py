from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.channel import ChannelStatus, ChannelType


class MacContactItem(BaseModel):
    id: UUID
    channel_id: UUID
    channel_name: str | None = None
    contact_id: UUID
    contact_display_name: str | None = None
    contact_phone: str | None = None
    cycle_month: str
    trigger_source: str
    first_activity_at: datetime


class MacStatsResponse(BaseModel):
    cycle_month: str
    mac_count: int
    included_mac: int = 0
    mac_remaining: int = 0
    is_over_mac: bool = False
    over_mac_count: int = 0
    over_mac_blocks: int = 0
    over_mac_price_per_100: float = 0
    estimated_over_mac_charge: float = 0
    campaign_messages_sent: int = 0


class MacChannelStatsResponse(BaseModel):
    channel_id: UUID
    channel_name: str
    channel_type: ChannelType | None = None
    channel_status: ChannelStatus | None = None
    cycle_month: str
    mac_count: int
    included_mac: int = 0
    mac_remaining: int = 0
    is_over_mac: bool = False
    over_mac_count: int = 0
    campaign_messages_sent: int = 0
    whatsapp_status: str | None = None
    whatsapp_phone: str | None = None
    subscription_starts_at: datetime | None = None
    subscription_ends_at: datetime | None = None
    billing_period_start: datetime | None = None
    billing_period_end: datetime | None = None
    over_mac_price_per_100: float = 0
    attributed_over_mac_count: int = 0
    estimated_channel_over_mac_charge: float = 0


class ChannelUsageBoardItem(BaseModel):
    channel_id: UUID
    channel_name: str
    organization_id: UUID
    channel_type: ChannelType
    channel_status: ChannelStatus
    external_id: str | None = None
    cycle_month: str
    mac_count: int
    included_mac: int = 0
    mac_remaining: int = 0
    is_over_mac: bool = False
    over_mac_count: int = 0
    campaign_messages_sent: int = 0
    whatsapp_status: str | None = None
    whatsapp_phone: str | None = None
    whatsapp_verified_name: str | None = None
    subscription_starts_at: datetime | None = None
    subscription_ends_at: datetime | None = None
    billing_period_start: datetime | None = None
    billing_period_end: datetime | None = None
    over_mac_price_per_100: float = 0
    attributed_over_mac_count: int = 0
    estimated_channel_over_mac_charge: float = 0


class ChannelUsageBoardResponse(BaseModel):
    cycle_month: str
    mac_count: int
    included_mac: int
    mac_remaining: int
    is_over_mac: bool
    over_mac_count: int
    over_mac_blocks: int
    over_mac_price_per_100: float
    estimated_over_mac_charge: float
    subscription_starts_at: datetime | None = None
    subscription_ends_at: datetime | None = None
    billing_period_start: datetime | None = None
    billing_period_end: datetime | None = None
    channels: list[ChannelUsageBoardItem] = Field(default_factory=list)


class MacTriggerBreakdownItem(BaseModel):
    source: str
    count: int


class MacDailyTrendItem(BaseModel):
    date: str
    count: int


class MacChannelBreakdownItem(BaseModel):
    channel_name: str
    channel_type: str
    count: int


class MacInsightsResponse(BaseModel):
    cycle_month: str
    billing_period_start: datetime | None = None
    billing_period_end: datetime | None = None
    included_mac: int = 0
    channel_count: int = 0
    trigger_breakdown: list[MacTriggerBreakdownItem] = Field(default_factory=list)
    channel_breakdown: list[MacChannelBreakdownItem] = Field(default_factory=list)
    daily_trend: list[MacDailyTrendItem] = Field(default_factory=list)
    campaign_messages_sent: int = 0


class BillingPeriodDTO(BaseModel):
    start: datetime
    end: datetime


class MacUsageDTO(BaseModel):
    used: int
    included: int
    remaining: int
    percentage: float


class MacOverageDTO(BaseModel):
    enabled: bool
    is_over: bool
    count: int
    blocks: int
    estimated_charge: float
    price_per_100: float


class MacPolicyDTO(BaseModel):
    limit_policy: str


class BillingUsageResponse(BaseModel):
    billing_period: BillingPeriodDTO
    mac: MacUsageDTO
    overage: MacOverageDTO
    policy: MacPolicyDTO
    breakdown_by_channel: list[MacChannelBreakdownItem] = Field(default_factory=list)
    breakdown_by_activity: list[MacTriggerBreakdownItem] = Field(default_factory=list)
    daily_trend: list[MacDailyTrendItem] = Field(default_factory=list)
    campaign_messages_sent: int = 0


class ChannelMacUsageMacDTO(BaseModel):
    channel_count: int
    channel_included: int = 0
    channel_remaining: int = 0
    usage_percent: float = 0
    workspace_used: int
    workspace_included: int
    workspace_remaining: int
    share_percent: float


class ChannelMacPricingDTO(BaseModel):
    plan_name: str
    included_mac: int
    over_mac_price_per_100: float


class ChannelMacUsageResponse(BaseModel):
    channel_id: UUID
    channel_name: str
    channel_type: str
    channel_status: str | None = None
    cycle_month: str
    billing_period: BillingPeriodDTO
    mac: ChannelMacUsageMacDTO
    overage: MacOverageDTO
    pricing: ChannelMacPricingDTO
    policy: MacPolicyDTO
    breakdown_by_activity: list[MacTriggerBreakdownItem] = Field(default_factory=list)
    daily_trend: list[MacDailyTrendItem] = Field(default_factory=list)
    campaign_messages_sent: int = 0
