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
    allow_multi_organization: bool
