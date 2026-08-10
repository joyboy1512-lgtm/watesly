from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    account_name: str = Field(min_length=2, max_length=160)
    organization_name: str = Field(min_length=2, max_length=160)
    organization_slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    country_code: str = Field(min_length=2, max_length=2)
    currency_code: str = Field(min_length=3, max_length=3)
    timezone: str = Field(default="Asia/Kuwait", min_length=3, max_length=64)
    preferred_language: str = Field(default="ar", pattern=r"^(ar|en)$")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    @field_validator("country_code", "currency_code")
    @classmethod
    def uppercase_codes(cls, value: str) -> str:
        return value.upper()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    account_id: UUID | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None, min_length=40)


class LogoutRequest(RefreshRequest):
    pass


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int


class RegistrationResponse(TokenResponse):
    user_id: UUID
    account_id: UUID
    organization_id: UUID


class OrganizationSummary(BaseModel):
    id: UUID
    name: str


class CurrentUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    full_name: str
    preferred_language: str
    is_super_admin: bool
    role: str | None = None
    permissions: list[str] = Field(default_factory=list)
    account_name: str | None = None
    branch_name: str | None = None
    organizations: list[OrganizationSummary] = Field(default_factory=list)


class AccountChoice(BaseModel):
    account_id: UUID
    account_name: str
    role: str

class AccountChoicesResponse(BaseModel):
    accounts: list[AccountChoice]
