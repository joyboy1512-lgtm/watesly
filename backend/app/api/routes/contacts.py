from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from fastapi.responses import PlainTextResponse, Response, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.contact import (
    ContactCreateRequest,
    ContactDuplicateGroup,
    ContactResponse,
    ContactStatsResponse,
)
from app.services.contact_management import (
    add_contact_tag,
    count_segment_contacts,
    delete_contact,
    export_contact_gdpr_json,
    export_contacts_csv,
    export_contacts_template_xlsx,
    export_contacts_xlsx,
    find_duplicate_phones,
    get_contact_activity,
    get_contact_or_raise,
    get_contacts_stats,
    get_custom_field_values,
    get_or_create_conversation_for_contact,
    import_contacts_file,
    list_contact_tags,
    remove_contact_tag,
    update_contact,
)
from app.services.contacts import create_contact, list_contacts
from app.services.contact_serialization import contact_to_response
from app.services.feature_flags import get_feature_flags

from pydantic import BaseModel, Field

router = APIRouter()

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

LIFECYCLE_STAGES = ("lead", "prospect", "customer", "churned")


class ContactUpdateBody(BaseModel):
    display_name: str | None = None
    email: str | None = None
    language: str | None = None
    country_code: str | None = None
    marketing_opt_in: bool | None = None
    lifecycle_stage: str | None = Field(default=None, max_length=30)


def _contact_permissions(context: AuthContext) -> set[str]:
    from app.core.permissions import Permission, role_has_permission

    role = context.membership.role
    return {perm.value for perm in Permission if role_has_permission(role, perm)}


async def _serialize_contacts(context: AuthContext, db: AsyncSession, contacts: list) -> list[ContactResponse]:
    flags = await get_feature_flags(db, account_id=context.account_id)
    perms = _contact_permissions(context)
    mask = flags.get("privacy_mask_agents", True)
    return [
        contact_to_response(item, role=context.membership.role, permissions=perms, privacy_mask_enabled=mask)
        for item in contacts
    ]


async def _serialize_contact(context: AuthContext, db: AsyncSession, contact) -> ContactResponse:
    flags = await get_feature_flags(db, account_id=context.account_id)
    return contact_to_response(
        contact,
        role=context.membership.role,
        permissions=_contact_permissions(context),
        privacy_mask_enabled=flags.get("privacy_mask_agents", True),
    )


@router.get("", response_model=list[ContactResponse])
async def get_contacts(
    limit: int = Query(100, ge=1, le=500),
    q: str | None = None,
    channel_id: UUID | None = None,
    organization_id: UUID | None = None,
    tag_id: UUID | None = None,
    segment_id: UUID | None = None,
    lifecycle_stage: str | None = None,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    contacts = await list_contacts(
        db,
        context.account_id,
        limit=limit,
        channel_id=channel_id,
        organization_id=organization_id,
        tag_id=tag_id,
        segment_id=segment_id,
        lifecycle_stage=lifecycle_stage,
        q=q,
    )
    return await _serialize_contacts(context, db, contacts)


@router.get("/stats", response_model=ContactStatsResponse)
async def get_contacts_stats_route(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_contacts_stats(db, context.account_id)


@router.get("/duplicates", response_model=list[ContactDuplicateGroup])
async def get_contacts_duplicates(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await find_duplicate_phones(db, context.account_id)


@router.post("", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def post_contact(
    payload: ContactCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_contact(db, account_id=context.account_id, payload=payload)
    except ValueError as exc:
        messages = {
            "INVALID_CHANNEL": (400, "Channel is invalid"),
            "CHANNEL_ORGANIZATION_MISMATCH": (400, "Channel does not belong to this organization"),
            "INVALID_TAG": (400, "One or more tags are invalid"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to create contact"))
        raise HTTPException(status_code=code, detail=detail) from exc


@router.get("/export")
async def export_contacts(
    format: str = Query("xlsx", pattern=r"^(xlsx|csv)$"),
    ids: str | None = Query(None, description="Comma-separated contact IDs for partial export"),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    contact_ids: list[UUID] | None = None
    if ids:
        try:
            contact_ids = [UUID(item.strip()) for item in ids.split(",") if item.strip()]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid contact IDs") from exc
        if not contact_ids:
            raise HTTPException(status_code=400, detail="No valid contact IDs provided")

    filename = "contacts-selected" if contact_ids else "contacts"
    try:
        if format == "csv":
            csv_data = await export_contacts_csv(db, context.account_id, contact_ids=contact_ids)
            return PlainTextResponse(
                csv_data,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
            )
        content = await export_contacts_xlsx(db, context.account_id, contact_ids=contact_ids)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Spreadsheet export is unavailable. Rebuild the API image after dependency updates.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to export contacts") from exc
    return Response(
        content=content,
        media_type=XLSX_MEDIA,
        headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"},
    )


@router.get("/export-template")
async def export_contacts_template(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
):
    try:
        content = await export_contacts_template_xlsx()
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Spreadsheet export is unavailable.") from exc
    return Response(
        content=content,
        media_type=XLSX_MEDIA,
        headers={"Content-Disposition": "attachment; filename=contacts-import-template.xlsx"},
    )


@router.post("/import")
async def import_contacts(
    organization_id: UUID = Form(...),
    channel_id: UUID = Form(...),
    file: UploadFile = File(...),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    filename = file.filename or "contacts.csv"
    try:
        return await import_contacts_file(
            db,
            account_id=context.account_id,
            organization_id=organization_id,
            channel_id=channel_id,
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


@router.get("/{contact_id}", response_model=ContactResponse)
async def get_contact(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        contact = await get_contact_or_raise(db, account_id=context.account_id, contact_id=contact_id)
        return await _serialize_contact(context, db, contact)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{contact_id}", response_model=ContactResponse)
async def patch_contact(
    contact_id: UUID,
    payload: ContactUpdateBody,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        contact = await update_contact(
            db,
            account_id=context.account_id,
            contact_id=contact_id,
            display_name=payload.display_name,
            email=payload.email,
            language=payload.language,
            country_code=payload.country_code,
            marketing_opt_in=payload.marketing_opt_in,
            lifecycle_stage=payload.lifecycle_stage,
        )
        return await _serialize_contact(context, db, contact)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{contact_id}", status_code=204)
async def remove_contact(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_contact(db, account_id=context.account_id, contact_id=contact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{contact_id}/activity")
async def get_contact_activity_route(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_contact_activity(db, account_id=context.account_id, contact_id=contact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{contact_id}/export-data")
async def export_contact_data(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        data = await export_contact_gdpr_json(db, account_id=context.account_id, contact_id=contact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f"attachment; filename=contact-{contact_id}.json"},
    )


@router.post("/{contact_id}/conversation")
async def post_contact_conversation(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation, created = await get_or_create_conversation_for_contact(
            db, account_id=context.account_id, contact_id=contact_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"conversation_id": str(conversation.id), "created": created}


@router.get("/{contact_id}/tags")
async def get_contact_tags(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_contact_tags(db, context.account_id, contact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{contact_id}/tags/{tag_id}", status_code=204)
async def post_contact_tag(
    contact_id: UUID,
    tag_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await add_contact_tag(db, account_id=context.account_id, contact_id=contact_id, tag_id=tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{contact_id}/tags/{tag_id}", status_code=204)
async def delete_contact_tag(
    contact_id: UUID,
    tag_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await remove_contact_tag(db, account_id=context.account_id, contact_id=contact_id, tag_id=tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{contact_id}/custom-fields")
async def get_contact_custom_fields(
    contact_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_custom_field_values(db, contact_id)
