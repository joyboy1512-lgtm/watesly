from pydantic import BaseModel


class CampaignReportResponse(BaseModel):
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
