from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.instagram_account import InstagramAccountStatus


class InstagramAccountCreateRequest(BaseModel):
    channel_id: UUID
    page_id: str = Field(min_length=2, max_length=80)
    access_token: str = Field(min_length=20)
    ig_user_id: str | None = Field(default=None, max_length=80)
    username: str | None = Field(default=None, max_length=160)
    page_name: str | None = Field(default=None, max_length=160)


class InstagramAccountResponse(BaseModel):
    id: UUID
    channel_id: UUID
    organization_id: UUID
    channel_name: str | None = None
    organization_name: str | None = None
    page_id: str
    ig_user_id: str
    username: str | None
    page_name: str | None
    status: InstagramAccountStatus
    webhook_subscribed_at: datetime | None = None
    meta_status_message: str | None = None
    created_at: datetime | None = None


class InstagramSendTextRequest(BaseModel):
    to: str = Field(min_length=2, max_length=120)
    text: str = Field(min_length=1, max_length=2000)


class InstagramSendMessageResponse(BaseModel):
    status: str
    message_id: str
    provider_response: dict | None = None


class InstagramWebhookStatusResponse(BaseModel):
    subscribed: bool
    callback_url: str
    error: str | None = None
