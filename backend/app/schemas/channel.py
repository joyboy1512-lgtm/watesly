from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.channel import ChannelStatus, ChannelType


class ChannelCreateRequest(BaseModel):
    organization_id: UUID
    type: ChannelType
    name: str = Field(min_length=2, max_length=120)
    external_id: str | None = Field(default=None, max_length=255)


class ChannelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    type: ChannelType
    name: str
    external_id: str | None
    status: ChannelStatus
