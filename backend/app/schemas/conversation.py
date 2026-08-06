from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.conversation import ConversationPriority, ConversationStatus


class ConversationUpdateRequest(BaseModel):
    assigned_membership_id: UUID | None = None
    status: ConversationStatus | None = None
    priority: ConversationPriority | None = None
    is_starred: bool | None = None
    snoozed_until: datetime | None = None
    archived: bool | None = None


class ConversationResponse(BaseModel):
    id: UUID
    organization_id: UUID
    channel_id: UUID
    contact_id: UUID
    assigned_membership_id: UUID | None
    status: ConversationStatus
    priority: ConversationPriority
    last_message_at: datetime | None
    first_response_at: datetime | None
    closed_at: datetime | None
    is_starred: bool = False
    snoozed_until: datetime | None = None
    archived_at: datetime | None = None
    unread_count: int = 0
    contact_name: str | None
    contact_address: str
    last_message_text: str | None
    last_message_status: str | None
    last_inbound_at: datetime | None = None
    service_window_open: bool = False
    service_window_expires_at: datetime | None = None
    requires_template: bool = True
    last_message_direction: str | None = None
    needs_reply: bool = False
    waiting_minutes: int | None = None
    sla_deadline_at: datetime | None = None
    sla_breached_at: datetime | None = None


class ConversationSendTextRequest(BaseModel):
    text: str


class ConversationSendTemplateRequest(BaseModel):
    template_id: UUID
    media_url: str | None = None
    filename: str | None = None


class ConversationSendProductRequest(BaseModel):
    product_id: UUID
    body: str | None = None
    footer: str | None = None


class ConversationSendProductListRequest(BaseModel):
    product_ids: list[UUID] = Field(default_factory=list, max_length=30)
    body: str = "اختر من قائمة منتجاتنا:"
    header: str | None = "منتجاتنا"
    footer: str | None = None


class ConversationRenderTextRequest(BaseModel):
    text: str


class ConversationAttributionResponse(BaseModel):
    source_campaign_id: UUID | None = None
    source_campaign_name: str | None = None
    source_tracked_link_id: UUID | None = None
    source_tracked_link_name: str | None = None


class ConversationKnowledgeArticle(BaseModel):
    id: str
    title: str
    body: str
    category: str


class ConversationPresenceAgent(BaseModel):
    membership_id: str
    name: str


class ConversationContextResponse(BaseModel):
    attribution: ConversationAttributionResponse
    knowledge_articles: list[ConversationKnowledgeArticle]
    viewers: list[ConversationPresenceAgent]
    typing: list[ConversationPresenceAgent]
    suggested_query: str | None = None
