from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.membership import MembershipRole, MembershipStatus


class InviteEmployeeRequest(BaseModel):
    email: EmailStr
    role: MembershipRole
    organization_ids: list[UUID] = Field(min_length=1)
    channel_ids: list[UUID] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class CreateEmployeeRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=6, max_length=128)
    role: MembershipRole
    organization_ids: list[UUID] = Field(min_length=1)
    channel_ids: list[UUID] = Field(default_factory=list)
    preferred_language: str = Field(default="ar", pattern=r"^(ar|en)$")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class InvitationResponse(BaseModel):
    invitation_id: UUID
    invitation_token: str
    invitation_accept_url: str
    expires_in_hours: int
    email_sent: bool = False


class AcceptInvitationRequest(BaseModel):
    token: str
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=6, max_length=128)
    preferred_language: str = Field(default="ar", pattern=r"^(ar|en)$")


class EmployeeUpdateRequest(BaseModel):
    role: MembershipRole | None = None
    status: MembershipStatus | None = None
    organization_ids: list[UUID] | None = None
    channel_ids: list[UUID] | None = None
    permissions: list[str] | None = None


class EmployeeResponse(BaseModel):
    user_id: UUID
    membership_id: UUID
    email: EmailStr
    full_name: str
    role: MembershipRole
    status: MembershipStatus
    organization_ids: list[UUID]
    channel_ids: list[UUID] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
