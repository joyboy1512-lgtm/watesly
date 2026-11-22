from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ComposerButtonTemplateCreate(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=1024)
    titles: str = Field(min_length=1, max_length=120)

    @field_validator("titles")
    @classmethod
    def validate_titles(cls, value: str) -> str:
        rows = [line.strip() for line in value.split("\n") if line.strip()]
        if not rows or len(rows) > 3:
            raise ValueError("titles must include 1 to 3 button labels")
        return "\n".join(row[:20] for row in rows)


class ComposerButtonTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=1024)
    titles: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("titles")
    @classmethod
    def validate_titles(cls, value: str | None) -> str | None:
        if value is None:
            return value
        rows = [line.strip() for line in value.split("\n") if line.strip()]
        if not rows or len(rows) > 3:
            raise ValueError("titles must include 1 to 3 button labels")
        return "\n".join(row[:20] for row in rows)


class ComposerButtonTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str
    body: str
    titles: str
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ComposerListSectionPayload(BaseModel):
    title: str = Field(default="خيارات", max_length=24)
    rows_text: str = Field(min_length=1, max_length=500)


class ComposerListTemplateCreate(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=1024)
    button_text: str = Field(min_length=1, max_length=20)
    sections: list[ComposerListSectionPayload] = Field(min_length=1, max_length=10)


class ComposerListTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=1024)
    button_text: str | None = Field(default=None, min_length=1, max_length=20)
    sections: list[ComposerListSectionPayload] | None = Field(default=None, min_length=1, max_length=10)
    is_active: bool | None = None


class ComposerListTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    name: str
    body: str
    button_text: str
    sections: list[ComposerListSectionPayload]
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def from_orm_item(cls, item) -> "ComposerListTemplateResponse":
        sections_raw = item.sections_json or []
        sections = [
            ComposerListSectionPayload(
                title=str(section.get("title", "خيارات"))[:24],
                rows_text=str(section.get("rows_text", "")),
            )
            for section in sections_raw
            if str(section.get("rows_text", "")).strip()
        ]
        return cls(
            id=item.id,
            organization_id=item.organization_id,
            name=item.name,
            body=item.body,
            button_text=item.button_text,
            sections=sections,
            is_active=item.is_active,
            created_at=getattr(item, "created_at", None),
            updated_at=getattr(item, "updated_at", None),
        )
