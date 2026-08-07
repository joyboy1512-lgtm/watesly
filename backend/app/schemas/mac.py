from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class MacContactItem(BaseModel):
    id: UUID
    channel_id: UUID
    contact_id: UUID
    contact_display_name: str | None = None
    contact_phone: str | None = None
    cycle_month: str
    trigger_source: str
    first_activity_at: datetime


class MacStatsResponse(BaseModel):
    cycle_month: str
    mac_count: int
    campaign_messages_sent: int = 0


class MacChannelStatsResponse(BaseModel):
    channel_id: UUID
    channel_name: str
    cycle_month: str
    mac_count: int
    campaign_messages_sent: int = 0