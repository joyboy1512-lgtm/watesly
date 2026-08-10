from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform_site_config import PlatformSiteConfig
from app.services.site_content_defaults import default_site_config


def _sanitize_brand_asset_url(value: object, default: str) -> str:
    if not isinstance(value, str):
        return default
    url = value.strip()
    if not url:
        return default
    if url.startswith("/brand/"):
        return url
    if url.startswith(("http://", "https://", "data:")):
        return url
    if url.startswith("/"):
        return default
    return url


def _sanitize_branding(branding: dict, defaults: dict) -> dict:
    merged = _deep_merge(defaults, branding)
    for field in ("logo_dark_url", "logo_light_url", "icon_url"):
        merged[field] = _sanitize_brand_asset_url(merged.get(field), defaults[field])
    hero = merged.get("hero_image_url")
    if isinstance(hero, str) and hero.strip() and hero.strip().startswith("/") and not hero.strip().startswith("/brand/"):
        merged["hero_image_url"] = defaults.get("hero_image_url", "")
    return merged


def _deep_merge(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


async def get_or_create_site_config(db: AsyncSession) -> PlatformSiteConfig:
    result = await db.execute(select(PlatformSiteConfig).limit(1))
    item = result.scalar_one_or_none()
    if item is not None:
        return item

    defaults = default_site_config()
    item = PlatformSiteConfig(
        branding_json=defaults["branding"],
        display_json=defaults["display"],
        content_json=defaults["locales"],
        is_published=True,
        published_at=datetime.now(UTC),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


def build_public_site_content(config: PlatformSiteConfig, *, locale: str) -> dict:
    defaults = default_site_config()
    locale_key = "en" if locale.startswith("en") else "ar"
    branding = _sanitize_branding(_deep_merge(defaults["branding"], config.branding_json or {}), defaults["branding"])
    display = _deep_merge(defaults["display"], config.display_json or {})
    locale_defaults = defaults["locales"].get(locale_key, defaults["locales"]["ar"])
    locale_content = (config.content_json or {}).get(locale_key, {})
    content = _deep_merge(locale_defaults, locale_content if isinstance(locale_content, dict) else {})

    return {
        "locale": locale_key,
        "branding": branding,
        "display": display,
        "landing": content.get("landing", {}),
        "login": content.get("login", {}),
        "stats": content.get("stats", []),
        "features": content.get("features", []),
        "steps": content.get("steps", []),
        "clients": content.get("clients", []),
        "mockup": content.get("mockup", {}),
        "api": content.get("api", {}),
        "published": bool(config.is_published),
    }


async def get_admin_site_config(db: AsyncSession) -> dict:
    item = await get_or_create_site_config(db)
    defaults = default_site_config()
    branding = _sanitize_branding(_deep_merge(defaults["branding"], item.branding_json or {}), defaults["branding"])
    display = _deep_merge(defaults["display"], item.display_json or {})
    locales: dict = {}
    for loc in ("ar", "en"):
        stored = (item.content_json or {}).get(loc, {})
        locales[loc] = _deep_merge(defaults["locales"][loc], stored if isinstance(stored, dict) else {})
    return {
        "id": item.id,
        "branding": branding,
        "display": display,
        "locales": locales,
        "is_published": item.is_published,
        "published_at": item.published_at,
        "updated_at": item.updated_at,
    }


async def update_site_config(
    db: AsyncSession,
    *,
    branding: dict | None,
    display: dict | None,
    locales: dict | None,
    is_published: bool | None,
    updated_by_user_id: UUID | None,
) -> PlatformSiteConfig:
    item = await get_or_create_site_config(db)
    if branding is not None:
        item.branding_json = branding
    if display is not None:
        item.display_json = display
    if locales is not None:
        item.content_json = locales
    if is_published is not None:
        item.is_published = is_published
        if is_published:
            item.published_at = datetime.now(UTC)
    item.updated_by_user_id = updated_by_user_id
    await db.commit()
    await db.refresh(item)
    return item
