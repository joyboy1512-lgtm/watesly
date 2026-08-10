from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class SiteBranding(BaseModel):
    app_name: str = "Watesly"
    logo_dark_url: str = "/brand/watesly-logo-dark.png"
    logo_light_url: str = "/brand/watesly-logo-light.png"
    icon_url: str = "/brand/watesly-icon.png"
    hero_image_url: str = ""
    primary_color: str = "#075e54"
    accent_color: str = "#25d366"


class SiteDisplay(BaseModel):
    show_hero_mockup: bool = True
    show_features: bool = True
    show_how: bool = True
    show_api: bool = True
    show_cta: bool = True
    show_stats: bool = True
    show_clients: bool = True


class SiteContentUpdateRequest(BaseModel):
    branding: dict[str, Any] | None = None
    display: dict[str, Any] | None = None
    locales: dict[str, Any] | None = None
    is_published: bool | None = None


class PublicSiteContentResponse(BaseModel):
    locale: str
    branding: dict[str, Any]
    display: dict[str, Any]
    landing: dict[str, Any]
    login: dict[str, Any]
    stats: list[dict[str, str]]
    features: list[dict[str, str]]
    steps: list[dict[str, str]]
    clients: list[dict[str, str]] = Field(default_factory=list)
    mockup: dict[str, Any]
    api: dict[str, Any]
    published: bool


class AdminSiteContentResponse(BaseModel):
    id: UUID
    branding: dict[str, Any]
    display: dict[str, Any]
    locales: dict[str, Any]
    is_published: bool
    published_at: datetime | None
    updated_at: datetime


class SiteAssetUploadResponse(BaseModel):
    url: str
    object_key: str
    filename: str
    content_type: str | None = None
