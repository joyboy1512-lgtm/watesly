from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.services.catalog import (
    create_catalog_product,
    delete_catalog_product,
    export_catalog_csv,
    export_catalog_xlsx,
    get_catalog_product,
    import_catalog_file,
    list_catalog_products,
    preview_catalog_reply,
    search_catalog_products,
    update_catalog_product,
)
from app.services.catalog_commerce import (
    list_catalog_categories,
    list_catalog_variant_groups,
    prepare_catalog_commerce_ids,
)
from app.services.catalog_meta_group import (
    create_catalog_meta_group,
    get_catalog_meta_group,
    update_catalog_meta_group,
)
from app.services.knowledge_base import suggest_smart_reply

router = APIRouter()

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class CatalogProductCreate(BaseModel):
    organization_id: UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    sku: str | None = None
    product_type: str = Field(default="product", pattern=r"^(product|service)$")
    description: str | None = None
    price: Decimal | None = None
    currency: str = "KWD"
    price_type: str = Field(default="fixed", pattern=r"^(fixed|from|quote)$")
    specs_json: dict = Field(default_factory=dict)
    keywords: str | None = None
    image_url: str | None = None
    category: str | None = None
    meta_retailer_id: str | None = None
    meta_item_group_id: str | None = None
    variant_size: str | None = None
    variant_color: str | None = None
    variant_attributes: dict = Field(default_factory=dict)
    external_source: str | None = None
    external_id: str | None = None
    meta_sync_enabled: bool = True
    is_active: bool = True
    sort_order: int = 0


class CatalogProductUpdate(BaseModel):
    organization_id: UUID | None = None
    name: str | None = None
    sku: str | None = None
    product_type: str | None = None
    description: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    price_type: str | None = None
    specs_json: dict | None = None
    keywords: str | None = None
    image_url: str | None = None
    category: str | None = None
    meta_retailer_id: str | None = None
    meta_item_group_id: str | None = None
    variant_size: str | None = None
    variant_color: str | None = None
    variant_attributes: dict | None = None
    external_source: str | None = None
    external_id: str | None = None
    meta_sync_enabled: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class CatalogSuggestRequest(BaseModel):
    query: str = Field(min_length=1)
    contact_name: str = ""
    mode: str = Field(default="catalog_first", pattern=r"^(catalog_first|kb_first|local)$")


class CatalogPreviewRequest(BaseModel):
    query: str = ""
    contact_name: str = ""
    product_ids: list[UUID] = Field(default_factory=list)


class MetaGroupVariantPayload(BaseModel):
    id: UUID | None = None
    name: str | None = None
    sku: str | None = None
    meta_retailer_id: str | None = None
    variant_size: str | None = None
    variant_color: str | None = None
    variant_attributes: dict = Field(default_factory=dict)
    price: Decimal | None = None
    image_url: str | None = None
    sort_order: int | None = None


class MetaGroupPayload(BaseModel):
    meta_item_group_id: str = Field(min_length=1, max_length=80)
    base_name: str = Field(min_length=1, max_length=200)
    organization_id: UUID | None = None
    category: str | None = None
    description: str | None = None
    product_type: str = Field(default="product", pattern=r"^(product|service)$")
    currency: str = "KWD"
    price_type: str = Field(default="fixed", pattern=r"^(fixed|from|quote)$")
    meta_sync_enabled: bool = True
    variants: list[MetaGroupVariantPayload] = Field(min_length=1)


_META_GROUP_ERRORS = {
    "GROUP_ID_REQUIRED": "أدخل معرّف مجموعة المنتج (item_group_id).",
    "VARIANTS_REQUIRED": "أضف نسخة واحدة على الأقل.",
    "GROUP_NOT_FOUND": "مجموعة المنتج غير موجودة.",
    "ORGANIZATION_REQUIRED": "اختر الفرع قبل حفظ المنتج",
    "ACCESS_FORBIDDEN": "لا تملك صلاحية على هذا الفرع",
}


def _meta_group_http_error(exc: ValueError) -> HTTPException:
    code = str(exc)
    return HTTPException(status_code=400 if code in _META_GROUP_ERRORS else 404, detail=_META_GROUP_ERRORS.get(code, code))


@router.get("")
async def get_catalog(
    include_inactive: bool = Query(False),
    organization_id: UUID | None = Query(None),
    category: str | None = Query(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_catalog_products(
        db,
        context.account_id,
        membership=context.membership,
        active_only=not include_inactive,
        organization_id=organization_id,
        category=category,
    )


@router.get("/search")
async def search_catalog(
    q: str = Query(min_length=1),
    include_inactive: bool = Query(False),
    organization_id: UUID | None = Query(None),
    category: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await search_catalog_products(
        db,
        context.account_id,
        q,
        limit=limit,
        active_only=not include_inactive,
        organization_id=organization_id,
        category=category,
        membership=context.membership,
    )


@router.get("/categories")
async def get_catalog_categories(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_catalog_categories(db, context.account_id)


@router.get("/variant-groups")
async def get_catalog_variant_groups(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_catalog_variant_groups(db, context.account_id)


@router.get("/meta-group/{group_id}")
async def get_meta_group(
    group_id: str,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_catalog_meta_group(
            db,
            account_id=context.account_id,
            meta_item_group_id=group_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise _meta_group_http_error(exc) from exc


@router.post("/meta-group", status_code=status.HTTP_201_CREATED)
async def post_meta_group(
    payload: MetaGroupPayload,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_catalog_meta_group(
            db,
            account_id=context.account_id,
            membership=context.membership,
            meta_item_group_id=payload.meta_item_group_id,
            base_name=payload.base_name,
            organization_id=payload.organization_id,
            category=payload.category,
            description=payload.description,
            product_type=payload.product_type,
            currency=payload.currency,
            price_type=payload.price_type,
            meta_sync_enabled=payload.meta_sync_enabled,
            variants=[variant.model_dump() for variant in payload.variants],
        )
    except ValueError as exc:
        raise _meta_group_http_error(exc) from exc


@router.put("/meta-group/{group_id}")
async def put_meta_group(
    group_id: str,
    payload: MetaGroupPayload,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    normalized = payload.meta_item_group_id.strip()
    if normalized != group_id.strip():
        raise HTTPException(status_code=400, detail="معرّف المجموعة في الرابط لا يطابق البيانات.")
    try:
        return await update_catalog_meta_group(
            db,
            account_id=context.account_id,
            membership=context.membership,
            meta_item_group_id=group_id,
            base_name=payload.base_name,
            organization_id=payload.organization_id,
            category=payload.category,
            description=payload.description,
            product_type=payload.product_type,
            currency=payload.currency,
            price_type=payload.price_type,
            meta_sync_enabled=payload.meta_sync_enabled,
            variants=[variant.model_dump() for variant in payload.variants],
        )
    except ValueError as exc:
        raise _meta_group_http_error(exc) from exc


@router.post("/prepare-commerce")
async def post_prepare_catalog_commerce(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    return await prepare_catalog_commerce_ids(db, account_id=context.account_id)


@router.post("/refresh-meta-status")
async def post_refresh_catalog_meta_status(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.meta_catalog_sync import refresh_catalog_meta_status

    try:
        return await refresh_catalog_meta_status(db, account_id=context.account_id)
    except ValueError as exc:
        detail = str(exc)
        if detail == "META_CATALOG_NOT_CONFIGURED":
            raise HTTPException(
                status_code=400,
                detail="فعّل Commerce وأدخل Meta Catalog ID من صفحة ربط WhatsApp أولاً.",
            ) from exc
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc


@router.post("/{product_id}/sync-meta")
async def post_sync_catalog_product_meta(
    product_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.meta_catalog_sync import sync_catalog_product_to_meta

    try:
        return await sync_catalog_product_to_meta(
            db,
            account_id=context.account_id,
            product_id=product_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = str(exc)
        messages = {
            "META_SYNC_DISABLED": "فعّل مزامنة Meta للمنتج من إعدادات المنتج أولاً.",
            "PRODUCT_NOT_ACTIVE": "لا يمكن مزامنة منتج مؤرشف.",
            "META_CATALOG_NOT_CONFIGURED": "فعّل Commerce وأدخل Meta Catalog ID من صفحة ربط WhatsApp أولاً.",
            "PRODUCT_NOT_FOUND": "المنتج غير موجود.",
        }
        if code in messages:
            raise HTTPException(status_code=400, detail=messages[code]) from exc
        raise HTTPException(status_code=404, detail=messages.get(code, code)) from exc


@router.get("/export")
async def export_catalog(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    include_inactive: bool = Query(False),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    active_only = not include_inactive
    filename = "catalog-export"
    try:
        if format == "csv":
            content = await export_catalog_csv(
                db,
                account_id=context.account_id,
                active_only=active_only,
            )
            return PlainTextResponse(
                content,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
            )
        content = await export_catalog_xlsx(
            db,
            account_id=context.account_id,
            active_only=active_only,
        )
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Spreadsheet export is unavailable. Rebuild the API image after dependency updates.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to export catalog") from exc
    return Response(
        content=content,
        media_type=XLSX_MEDIA,
        headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"},
    )


@router.post("/preview-reply")
async def post_catalog_preview(
    payload: CatalogPreviewRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    if not payload.query.strip() and not payload.product_ids:
        raise HTTPException(status_code=400, detail="Provide query or product_ids")
    return await preview_catalog_reply(
        db,
        account_id=context.account_id,
        query=payload.query,
        contact_name=payload.contact_name,
        product_ids=payload.product_ids,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_catalog_product(
    payload: CatalogProductCreate,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_catalog_product(
            db, account_id=context.account_id, membership=context.membership, **payload.model_dump()
        )
    except ValueError as exc:
        code = str(exc)
        messages = {
            "ORGANIZATION_REQUIRED": "اختر الفرع قبل حفظ المنتج",
            "ACCESS_FORBIDDEN": "لا تملك صلاحية على هذا الفرع",
        }
        raise HTTPException(status_code=400, detail=messages.get(code, code)) from exc


@router.get("/{product_id}")
async def get_product(
    product_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_catalog_product(
            db, account_id=context.account_id, product_id=product_id, membership=context.membership
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{product_id}")
async def patch_product(
    product_id: UUID,
    payload: CatalogProductUpdate,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_catalog_product(
            db,
            account_id=context.account_id,
            product_id=product_id,
            membership=context.membership,
            **payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{product_id}", status_code=204)
async def remove_product(
    product_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_catalog_product(
            db,
            account_id=context.account_id,
            product_id=product_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/import")
async def import_catalog(
    file: UploadFile = File(...),
    organization_id: UUID | None = Form(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    filename = file.filename or "catalog.xlsx"
    try:
        return await import_catalog_file(
            db,
            account_id=context.account_id,
            organization_id=organization_id,
            content=content,
            filename=filename,
        )
    except ValueError as exc:
        code = str(exc)
        messages = {
            "UNSUPPORTED_FILE_FORMAT": "Unsupported file format. Use .xlsx or .csv",
            "FILE_TOO_LARGE": "File is too large (max 10 MB)",
        }
        raise HTTPException(status_code=400, detail=messages.get(code, code)) from exc


@router.post("/suggest-reply")
async def catalog_suggest(
    payload: CatalogSuggestRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND)),
    db: AsyncSession = Depends(get_db),
):
    return await suggest_smart_reply(
        db,
        account_id=context.account_id,
        query=payload.query,
        contact_name=payload.contact_name,
        mode=payload.mode,
    )
