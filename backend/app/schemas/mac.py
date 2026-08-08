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


class ChannelUsageBoardItem(BaseModel):
    channel_id: UUID
    channel_name: str
    organization_id: UUID
    channel_type: ChannelType
    channel_status: ChannelStatus
    external_id: str | None = None
    cycle_month: str
    mac_count: int
    campaign_messages_sent: int = 0
    whatsapp_status: str | None = None
    whatsapp_phone: str | None = None
    whatsapp_verified_name: str | None = None


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
    channels: list[ChannelUsageBoardItem] = Field(default_factory=list)
