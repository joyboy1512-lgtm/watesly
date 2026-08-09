from datetime import datetime
from uuid import UUID

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

ContactGender = Literal["male", "female", "unknown"]


class ContactCreateRequest(BaseModel):
    organization_id: UUID
    channel_id: UUID
    external_address: str = Field(min_length=3, max_length=120)
    display_name: str | None = Field(default=None, max_length=160)
    email: EmailStr | None = None
    language: str | None = Field(default=None, max_length=10)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    lifecycle_stage: str | None = Field(default=None, max_length=30)
    tag_ids: list[UUID] = Field(default_factory=list)

    @field_validator("email", "display_name", "language", "country_code", mode="before")
    @classmethod
    def empty_str_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("external_address", "display_name", "language", mode="before")
    @classmethod
    def strip_optional_strings(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("country_code")
    @classmethod
    def normalize_country_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().upper()


class ContactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    channel_id: UUID
    external_address: str
    display_name: str | None
    email: EmailStr | None
    language: str | None
    country_code: str | None
    gender: ContactGender = "unknown"
    marketing_opt_in: bool = True
    lifecycle_stage: str = "lead"
    utm_source: str | None = None
    utm_campaign: str | None = None
    referral_json: dict | None = None
    created_at: datetime
    updated_at: datetime


class ContactActivityResponse(BaseModel):
    last_message_text: str | None = None
    last_message_at: datetime | None = None
    last_message_direction: str | None = None
    conversations: list[dict] = Field(default_factory=list)
    notes: list[dict] = Field(default_factory=list)


class ContactStatsResponse(BaseModel):
    total: int
    new_this_week: int
    without_name: int
    inactive_30d: int


class ContactDuplicateGroup(BaseModel):
    phone: str
    contact_ids: list[UUID]
    count: int
