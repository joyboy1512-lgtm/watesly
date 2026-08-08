from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.whatsapp_account import WhatsAppAccountStatus


class WhatsAppTokenUpdateRequest(BaseModel):
    access_token: str = Field(min_length=20)


class WhatsAppTokenStatusResponse(BaseModel):
    valid: bool
    error: str | None = None
    auth_error: bool = False


class WhatsAppAccountCreateRequest(BaseModel):
    channel_id: UUID
    waba_id: str = Field(min_length=2, max_length=80)
    phone_number_id: str = Field(min_length=2, max_length=80)
    display_phone_number: str = Field(min_length=5, max_length=40)
    verified_name: str | None = Field(default=None, max_length=160)
    access_token: str = Field(min_length=20)


class WhatsAppEmbeddedSignupRequest(BaseModel):
    channel_id: UUID
    waba_id: str = Field(min_length=2, max_length=80)
    phone_number_id: str = Field(min_length=2, max_length=80)
    code: str | None = Field(default=None, min_length=8)
    access_token: str | None = Field(default=None, min_length=20)
    display_phone_number: str | None = Field(default=None, max_length=40)
    verified_name: str | None = Field(default=None, max_length=160)


class WhatsAppEmbeddedSignupConfigResponse(BaseModel):
    enabled: bool
    app_id: str | None = None
    config_id: str | None = None
    api_version: str


class WhatsAppAccountResponse(BaseModel):
    id: UUID
    channel_id: UUID
    organization_id: UUID
    channel_name: str | None = None
    organization_name: str | None = None
    waba_id: str
    phone_number_id: str
    display_phone_number: str
    verified_name: str | None
    status: WhatsAppAccountStatus
    connection_method: str = "manual"
    quality_rating: str | None = None
    messaging_limit_tier: str | None = None
    messaging_limit: int | None = None
    health_synced_at: datetime | None = None
    meta_catalog_id: str | None = None
    commerce_enabled: bool = False
    catalog_synced_at: datetime | None = None


class WhatsAppCommerceSettingsRequest(BaseModel):
    meta_catalog_id: str | None = Field(default=None, max_length=80)
    commerce_enabled: bool | None = None


class SendTextMessageRequest(BaseModel):
    to: str = Field(min_length=7, max_length=30)
    text: str = Field(min_length=1, max_length=4096)
    preview_url: bool = False

    @field_validator("to")
    @classmethod
    def normalize_recipient(cls, value: str) -> str:
        normalized = "".join(ch for ch in value if ch.isdigit())
        if len(normalized) < 7:
            raise ValueError("Invalid recipient number")
        return normalized


class SendMessageResponse(BaseModel):
    local_message_id: UUID
    external_message_id: str | None
    status: str
