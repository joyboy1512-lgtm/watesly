from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class OrganizationCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    country_code: str = Field(min_length=2, max_length=2)
    currency_code: str = Field(min_length=3, max_length=3)
    timezone: str = Field(default="Asia/Kuwait", min_length=3, max_length=64)
    default_language: str = Field(default="ar", pattern=r"^(ar|en)$")
    max_users: int = Field(default=0, ge=0, description="0 = unlimited users for this branch")
    max_channels: int = Field(default=0, ge=0, description="0 = unlimited channels for this branch")
    branch_admin_email: EmailStr | None = None

    @field_validator("branch_admin_email")
    @classmethod
    def normalize_branch_admin_email(cls, value: EmailStr | None) -> str | None:
        if value is None:
            return None
        return str(value).strip().lower()

    @field_validator("country_code", "currency_code")
    @classmethod
    def uppercase_codes(cls, value: str) -> str:
        return value.upper()


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    country_code: str
    currency_code: str
    timezone: str
    default_language: str
    status: str
    max_users: int = 0
    max_channels: int = 0
    active_member_count: int = 0
    active_channel_count: int = 0


class OrganizationCreateResponse(OrganizationResponse):
    branch_admin_invitation_sent: bool = False
    branch_admin_email: str | None = None
