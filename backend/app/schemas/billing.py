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
    allow_multi_organization: bool
    cycle_month: str | None = None
    mac_count: int = 0
    mac_remaining: int = 0
    is_over_mac: bool = False
    over_mac_count: int = 0
    over_mac_blocks: int = 0
    estimated_over_mac_charge: float = 0
