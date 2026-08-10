from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.campaign import CampaignStatus


class CampaignRecipientInput(BaseModel):
    contact_id: UUID
    template_parameters: list[dict] = Field(default_factory=list)


class CampaignCreateRequest(BaseModel):
    organization_id: UUID
    whatsapp_account_id: UUID
    template_id: UUID
    name: str = Field(min_length=2, max_length=160)
    scheduled_at: datetime | None = None
    recipients: list[CampaignRecipientInput] = Field(min_length=1, max_length=10000)
    include_opt_out_option: bool = True
    exclude_marketing_opt_out: bool = True


class CampaignPreflightRequest(BaseModel):
    template_id: UUID
    contact_ids: list[UUID] = Field(min_length=1, max_length=10000)
    whatsapp_account_id: UUID | None = None
    include_opt_out_option: bool = True


class CampaignResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    whatsapp_account_id: UUID
    template_id: UUID
    name: str
    status: CampaignStatus
    scheduled_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    include_opt_out_option: bool = True
    archived_at: datetime | None = None


class CampaignReportSummary(BaseModel):
    total: int
    pending: int
    queued: int
    sent: int
    delivered: int
    read: int
    failed: int
    skipped: int
    delivery_rate: float
    read_rate: float


class CampaignListItemResponse(CampaignResponse):
    report: CampaignReportSummary
