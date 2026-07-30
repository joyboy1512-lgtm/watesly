from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class SendMediaMessageRequest(BaseModel):
    to: str = Field(min_length=7, max_length=30)
    media_url: HttpUrl
    caption: str | None = Field(default=None, max_length=1024)
    filename: str | None = Field(default=None, max_length=255)


class SendTemplateMessageRequest(BaseModel):
    to: str = Field(min_length=7, max_length=30)
    template_name: str = Field(min_length=1, max_length=512)
    language_code: str = Field(min_length=2, max_length=20)
    components: list[dict] = Field(default_factory=list)


class MediaSendResponse(BaseModel):
    local_message_id: UUID
    external_message_id: str | None
    status: str


class SendProductMessageRequest(BaseModel):
    to: str = Field(min_length=7, max_length=30)
    product_retailer_id: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=1024)
    footer: str | None = Field(default=None, max_length=60)
    product_id: UUID | None = None


class SendProductListMessageRequest(BaseModel):
    to: str = Field(min_length=7, max_length=30)
    body: str = Field(min_length=1, max_length=1024)
    header: str | None = Field(default=None, max_length=60)
    footer: str | None = Field(default=None, max_length=60)
    product_ids: list[UUID] = Field(default_factory=list, max_length=30)
