from tempfile import SpooledTemporaryFile
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.admin import require_super_admin
from app.api.dependencies.auth import AuthContext
from app.core.config import settings
from app.core.file_security import sanitize_filename, validate_file_content
from app.db.session import get_db
from app.schemas.site_content import (
    AdminSiteContentResponse,
    PublicSiteContentResponse,
    SiteAssetUploadResponse,
    SiteContentUpdateRequest,
)
from app.services.site_content import (
    build_public_site_content,
    get_admin_site_config,
    get_or_create_site_config,
    update_site_config,
)
from app.services.storage import storage

router = APIRouter()
public_router = APIRouter()

MAX_UPLOAD_SIZE = settings.max_upload_bytes
ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/svg+xml",
}


@public_router.get("/site-content", response_model=PublicSiteContentResponse)
async def get_public_site_content(
    locale: str = Query(default="ar"),
    db: AsyncSession = Depends(get_db),
) -> PublicSiteContentResponse:
    item = await get_or_create_site_config(db)
    if not item.is_published:
        from app.services.site_content_defaults import default_site_config

        defaults = default_site_config()
        locale_key = "en" if locale.startswith("en") else "ar"
        locale_defaults = defaults["locales"].get(locale_key, defaults["locales"]["ar"])
        return PublicSiteContentResponse(
            locale=locale_key,
            branding=defaults["branding"],
            display=defaults["display"],
            landing=locale_defaults.get("landing", {}),
            login=locale_defaults.get("login", {}),
            stats=locale_defaults.get("stats", []),
            features=locale_defaults.get("features", []),
            steps=locale_defaults.get("steps", []),
            mockup=locale_defaults.get("mockup", {}),
            api=locale_defaults.get("api", {}),
            published=False,
        )
    payload = build_public_site_content(item, locale=locale)
    return PublicSiteContentResponse(**payload)


@router.get("/site-content", response_model=AdminSiteContentResponse)
async def get_admin_site_content_route(
    _: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminSiteContentResponse:
    data = await get_admin_site_config(db)
    return AdminSiteContentResponse(**data)


@router.put("/site-content", response_model=AdminSiteContentResponse)
async def put_admin_site_content(
    payload: SiteContentUpdateRequest,
    context: AuthContext = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminSiteContentResponse:
    item = await update_site_config(
        db,
        branding=payload.branding,
        display=payload.display,
        locales=payload.locales,
        is_published=payload.is_published,
        updated_by_user_id=context.user.id,
    )
    data = await get_admin_site_config(db)
    data["id"] = item.id
    return AdminSiteContentResponse(**data)


@router.post("/site-content/assets", response_model=SiteAssetUploadResponse)
async def upload_site_asset(
    file: UploadFile = File(...),
    _: AuthContext = Depends(require_super_admin),
) -> SiteAssetUploadResponse:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported file type")

    safe_name = sanitize_filename(file.filename or "asset.png")
    total = 0
    header = b""
    spool = SpooledTemporaryFile(max_size=min(MAX_UPLOAD_SIZE, 5 * 1024 * 1024), mode="w+b")
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_UPLOAD_SIZE:
            spool.close()
            raise HTTPException(status_code=413, detail="File exceeds the configured upload limit")
        if len(header) < 8192:
            header = (header + chunk)[:8192]
        spool.write(chunk)
    try:
        validate_file_content(safe_name, file.content_type, header)
    except ValueError as exc:
        spool.close()
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    spool.seek(0)
    key, public_url = storage.upload_platform_fileobj(
        filename=safe_name,
        content_type=file.content_type,
        fileobj=spool,
    )
    spool.close()
    return SiteAssetUploadResponse(
        url=public_url,
        object_key=key,
        filename=safe_name,
        content_type=file.content_type,
    )
