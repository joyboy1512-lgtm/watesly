from uuid import UUID

from pydantic import BaseModel, Field


class CustomInboxFilters(BaseModel):
    tag_ids: list[UUID] = Field(default_factory=list)
    assigned_membership_id: UUID | None = None
    priority: str | None = None
    status: str | None = None
    starred: bool | None = None
    needs_reply: bool | None = None
    channel_type: str | None = None


class CustomInboxCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    organization_id: UUID | None = None
    filters: CustomInboxFilters = Field(default_factory=CustomInboxFilters)


class CustomInboxUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    filters: CustomInboxFilters | None = None


class CustomInboxResponse(BaseModel):
    id: UUID
    account_id: UUID
    organization_id: UUID | None
    created_by_membership_id: UUID | None
    name: str
    description: str | None
    filters: CustomInboxFilters
