from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrganizationCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    country_code: str = Field(min_length=2, max_length=2)
    currency_code: str = Field(min_length=3, max_length=3)
    timezone: str = Field(default="Asia/Kuwait", min_length=3, max_length=64)
    default_language: str = Field(default="ar", pattern=r"^(ar|en)$")

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
