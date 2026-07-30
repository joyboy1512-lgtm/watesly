from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.support_access_grant import SupportAccessStatus


class TrustStatusResponse(BaseModel):
    encryption_enabled: bool
    key_version: int | None
    active_support_grants: int
    last_audit_event_at: datetime | None


class SupportAccessCreateRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=2000)
    duration_hours: int = Field(ge=1, le=24)
    scope: str = Field(default="diagnostics", max_length=120)
    support_user_id: UUID | None = None


class SupportAccessResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    granted_by_user_id: UUID
    support_user_id: UUID | None
    reason: str
    scope: str
    starts_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    status: SupportAccessStatus


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_user_id: UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    ip_address: str | None
    user_agent: str | None
    metadata: dict | None = Field(validation_alias="details", serialization_alias="metadata")
    created_at: datetime
