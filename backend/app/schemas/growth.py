from uuid import UUID

from pydantic import BaseModel, Field


class KnowledgeArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    category: str = Field(default="general", max_length=80)
    keywords: str | None = Field(default=None, max_length=500)
    is_active: bool = True
    sort_order: int = 0
    language: str = Field(default="ar", max_length=10)


class KnowledgeArticleUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=8000)
    category: str | None = Field(default=None, max_length=80)
    keywords: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None
    sort_order: int | None = None
    language: str | None = Field(default=None, max_length=10)


class KnowledgeArticleResponse(BaseModel):
    id: UUID
    title: str
    body: str
    category: str
    keywords: str | None
    is_active: bool
    sort_order: int
    usage_count: int = 0
    language: str = "ar"


class TrackedLinkCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone_number: str = Field(min_length=5, max_length=40)
    prefill_message: str | None = Field(default=None, max_length=1000)
    campaign_id: UUID | None = None


class TrackedLinkResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    phone_number: str
    prefill_message: str | None
    campaign_id: UUID | None
    click_count: int
    track_url: str
    wa_me_url: str


class ConversationRatingRequest(BaseModel):
    score: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)
