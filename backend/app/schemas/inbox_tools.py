from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TagCreateRequest(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=80)
    color: str | None = Field(default=None, max_length=20)


class TagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str
    color: str | None


class ConversationTagRequest(BaseModel):
    tag_id: UUID


class NoteCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    mentions: list[str] = Field(default_factory=list)


class NoteResponse(BaseModel):
    id: UUID
    conversation_id: UUID
    user_id: UUID
    body: str
    mentions: list | None = None
    is_internal: bool = True
    created_at: datetime


class QuickReplyCreateRequest(BaseModel):
    organization_id: UUID
    channel_id: UUID | None = None
    shortcut: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=5000)
    category: str | None = Field(default=None, max_length=80)
    tags: str | None = Field(default=None, max_length=500)
    tone_variant: str | None = Field(default=None, pattern=r"^(friendly|formal|concise)$")
    is_shared: bool = True
    sort_order: int = 0


class QuickReplyUpdateRequest(BaseModel):
    organization_id: UUID | None = None
    channel_id: UUID | None = None
    shortcut: str | None = Field(default=None, min_length=1, max_length=80)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    category: str | None = Field(default=None, max_length=80)
    tags: str | None = Field(default=None, max_length=500)
    tone_variant: str | None = Field(default=None, pattern=r"^(friendly|formal|concise)$")
    is_shared: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class QuickReplyFromConversationRequest(BaseModel):
    conversation_id: UUID
    title: str | None = Field(default=None, max_length=120)
    shortcut: str | None = Field(default=None, max_length=80)
    category: str | None = Field(default=None, max_length=80)
    tags: str | None = Field(default=None, max_length=500)


class QuickReplySuggestRequest(BaseModel):
    query: str = Field(min_length=1, max_length=5000)
    organization_id: UUID | None = None
    channel_id: UUID | None = None
    limit: int = Field(default=5, ge=1, le=20)


class QuickReplyImportRequest(BaseModel):
    organization_id: UUID
    csv_content: str = Field(min_length=1)


class QuickReplySeedRequest(BaseModel):
    organization_id: UUID


class QuickReplyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    channel_id: UUID | None = None
    shortcut: str
    title: str
    body: str
    category: str | None = None
    tags: str | None = None
    tone_variant: str | None = None
    is_shared: bool = True
    is_active: bool = True
    sort_order: int = 0
    usage_count: int = 0
