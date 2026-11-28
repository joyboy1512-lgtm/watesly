from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.messenger_account import MessengerAccountStatus


class MessengerAccountCreateRequest(BaseModel):
    channel_id: UUID
    page_id: str = Field(min_length=2, max_length=80)
    access_token: str = Field(min_length=20)
    page_name: str | None = Field(default=None, max_length=160)


class MessengerAccountResponse(BaseModel):
    id: UUID
    channel_id: UUID
    organization_id: UUID
    channel_name: str | None = None
    organization_name: str | None = None
    page_id: str
    page_name: str | None
    status: MessengerAccountStatus
    webhook_subscribed_at: datetime | None = None
    meta_status_message: str | None = None
    created_at: datetime | None = None


class MessengerSendTextRequest(BaseModel):
    to: str = Field(min_length=2, max_length=120)
    text: str = Field(min_length=1, max_length=2000)


class MessengerSendMessageResponse(BaseModel):
    status: str
    message_id: str
    provider_response: dict | None = None


class MessengerWebhookStatusResponse(BaseModel):
    subscribed: bool
    callback_url: str
    error: str | None = None
