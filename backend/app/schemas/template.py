from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.whatsapp_template import TemplateCategory, TemplateStatus


class TemplateCreateRequest(BaseModel):
    whatsapp_account_id: UUID
    meta_template_id: str | None = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=512)
    language: str = Field(min_length=2, max_length=20)
    category: TemplateCategory
    body_text: str | None = Field(default=None, max_length=4096)
    components: list[dict] = Field(default_factory=list)


class TemplateUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=512)
    language: str | None = Field(default=None, min_length=2, max_length=20)
    category: TemplateCategory | None = None
    status: TemplateStatus | None = None
    body_text: str | None = Field(default=None, max_length=4096)
    components: list[dict] | None = None


class TemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    whatsapp_account_id: UUID
    meta_template_id: str | None
    name: str
    language: str
    category: TemplateCategory
    status: TemplateStatus
    body_text: str | None
    components: list | None
    meta_status_detail: str | None = None
