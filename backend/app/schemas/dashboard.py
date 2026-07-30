from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class DashboardWaitingConversation(BaseModel):
    id: UUID
    contact_name: str | None
    contact_address: str
    last_message_text: str | None
    last_message_at: datetime | None
    waiting_minutes: int | None


class DashboardLatestCampaign(BaseModel):
    id: UUID
    name: str
    status: str
    completed_at: datetime | None
    total: int
    sent: int
    delivered: int
    read: int
    failed: int


class DashboardAlert(BaseModel):
    level: str
    code: str
    message: str
    action_path: str | None = None


class DashboardSummaryResponse(BaseModel):
    open_conversations: int
    pending_conversations: int
    closed_conversations: int
    total_conversations: int
    total_contacts: int
    active_users: int
    total_channels: int
    sent_messages_today: int
    received_messages_today: int
    csat_average: float | None = None
    csat_total_ratings: int = 0
    csat_promoters_pct: float | None = None
    first_response_avg_minutes: float | None = None
    waiting_conversations: list[DashboardWaitingConversation] = Field(default_factory=list)
    latest_campaign: DashboardLatestCampaign | None = None
    alerts: list[DashboardAlert] = Field(default_factory=list)
