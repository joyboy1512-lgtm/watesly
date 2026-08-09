from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.assignment_rule import AssignmentStrategy


class TeamCreateRequest(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    membership_ids: list[UUID] = Field(default_factory=list)


class TeamUpdateMembersRequest(BaseModel):
    membership_ids: list[UUID]


class TeamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    membership_ids: list[UUID] | None = None


class TeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str
    description: str | None
    membership_ids: list[UUID]


class AssignmentRuleCreateRequest(BaseModel):
    organization_id: UUID
    channel_id: UUID | None = None
    team_id: UUID
    name: str = Field(min_length=2, max_length=120)
    strategy: AssignmentStrategy = AssignmentStrategy.ROUND_ROBIN
    priority: int = Field(default=100, ge=1, le=1000)
    is_active: bool = True


class AssignmentRuleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    strategy: AssignmentStrategy | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)
    channel_id: UUID | None = None
    is_active: bool | None = None


class AssignmentRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    channel_id: UUID | None
    team_id: UUID
    name: str
    strategy: AssignmentStrategy
    priority: int
    is_active: bool
