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
    submit_to_meta: bool = True


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


class AiTemplateGenerateRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=2000)
    language: str = Field(default="ar", min_length=2, max_length=20)
    category: str | None = Field(default=None, max_length=30)
    brand_hint: str | None = Field(default=None, max_length=500)


class AiTemplateIdeaMessage(BaseModel):
    role: str = Field(min_length=1, max_length=20)
    content: str = Field(min_length=1, max_length=4000)


class AiTemplateIdeaChatRequest(BaseModel):
    messages: list[AiTemplateIdeaMessage] = Field(min_length=1, max_length=40)
    brand_hint: str | None = Field(default=None, max_length=500)


class AiTemplateIdeaChatResponse(BaseModel):
    reply: str
    topic_summary: str | None = None
    ready_for_draft: bool = False
    suggested_category: str = "marketing"
    suggested_header: str = "NONE"


class AiTemplateRefineRequest(BaseModel):
    draft: dict
    instruction: str = Field(min_length=2, max_length=2000)


class AiTemplateImageRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=1200)


class AiTemplateDraftResponse(BaseModel):
    name: str
    language: str
    category: str
    header_type: str
    header_text: str
    body_text: str
    body_samples: list[str]
    footer_text: str
    buttons: list[dict]
    image_prompt: str
    notes: str


class AiTemplateImageResponse(BaseModel):
    id: UUID
    filename: str
    content_type: str | None
    size_bytes: int
    object_key: str
    public_url: str
    prompt: str
