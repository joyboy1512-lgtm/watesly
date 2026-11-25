from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.db.session import get_db
from app.core.permissions import Permission
from app.models.whatsapp_template import WhatsAppTemplate
from app.schemas.template import (
    AiTemplateDraftResponse,
    AiTemplateGenerateRequest,
    AiTemplateImageRequest,
    AiTemplateImageResponse,
    AiTemplateRefineRequest,
    TemplateCreateRequest,
    TemplateResponse,
    TemplateUpdateRequest,
)
from app.services.ai_templates import (
    generate_template_draft,
    generate_template_header_image,
    refine_template_draft,
)
from app.services.templates import (
    create_template,
    delete_template,
    list_templates,
    resubmit_template_to_meta,
    sync_templates_from_meta,
    update_template,
)

router = APIRouter()


def _ai_http_error(exc: ValueError) -> HTTPException:
    code = str(exc)
    if code == "LLM_NOT_CONFIGURED":
        return HTTPException(status_code=400, detail="LLM_NOT_CONFIGURED")
    if code.startswith("LLM_FAILED:") or code.startswith("IMAGE_FAILED:"):
        return HTTPException(status_code=502, detail=code)
    if code in {"EMPTY_TOPIC", "EMPTY_INSTRUCTION", "EMPTY_IMAGE_PROMPT", "EMPTY_TEMPLATE_BODY", "EMPTY_AI_RESPONSE", "INVALID_AI_JSON"}:
        return HTTPException(status_code=400, detail=code)
    return HTTPException(status_code=400, detail=code)


@router.get("", response_model=list[TemplateResponse])
async def get_templates(
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_templates(db, context.account_id, membership=context.membership)


@router.post("/ai/generate", response_model=AiTemplateDraftResponse)
async def ai_generate_template(
    payload: AiTemplateGenerateRequest,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await generate_template_draft(
            db,
            account_id=context.account_id,
            topic=payload.topic,
            language=payload.language,
            category=payload.category,
            brand_hint=payload.brand_hint,
        )
    except ValueError as exc:
        raise _ai_http_error(exc) from exc


@router.post("/ai/refine", response_model=AiTemplateDraftResponse)
async def ai_refine_template(
    payload: AiTemplateRefineRequest,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await refine_template_draft(
            db,
            account_id=context.account_id,
            draft=payload.draft,
            instruction=payload.instruction,
        )
    except ValueError as exc:
        raise _ai_http_error(exc) from exc


@router.post("/ai/image", response_model=AiTemplateImageResponse)
async def ai_template_image(
    payload: AiTemplateImageRequest,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await generate_template_header_image(
            db,
            account_id=context.account_id,
            prompt=payload.prompt,
            user_id=context.user.id,
        )
    except ValueError as exc:
        raise _ai_http_error(exc) from exc


@router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def post_template(
    payload: TemplateCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_template(
            db,
            account_id=context.account_id,
            payload=payload,
            membership=context.membership,
        )
    except ValueError as exc:
        if str(exc) == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail="Invalid WhatsApp account") from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Template already exists") from exc


@router.post("/{template_id}/submit", response_model=TemplateResponse)
async def submit_template(
    template_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await resubmit_template_to_meta(
            db,
            account_id=context.account_id,
            template_id=template_id,
        )
    except ValueError as exc:
        code = str(exc)
        if code == "TEMPLATE_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Template not found") from exc
        if code == "TEMPLATE_ALREADY_APPROVED":
            raise HTTPException(status_code=409, detail="Template is already approved") from exc
        if code == "META_SUBMIT_FAILED":
            template = await db.get(WhatsAppTemplate, template_id)
            if template is not None and template.account_id == context.account_id:
                return template
            raise HTTPException(status_code=502, detail="Meta rejected the template submission") from exc
        raise HTTPException(status_code=400, detail=code) from exc


@router.post("/sync/{whatsapp_account_id}")
async def sync_templates(
    whatsapp_account_id,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        created, updated = await sync_templates_from_meta(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            membership=context.membership,
        )
    except ValueError as exc:
        if str(exc) == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        raise HTTPException(status_code=404, detail="WhatsApp account not found") from exc
    return {"created": created, "updated": updated}


@router.patch("/{template_id}", response_model=TemplateResponse)
async def patch_template(
    template_id: UUID,
    payload: TemplateUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_template(
            db,
            account_id=context.account_id,
            template_id=template_id,
            payload=payload,
            membership=context.membership,
        )
    except ValueError as exc:
        if str(exc) == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        raise HTTPException(status_code=404, detail="Template not found") from exc


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_template(
    template_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_template(
            db,
            account_id=context.account_id,
            template_id=template_id,
            membership=context.membership,
        )
    except ValueError as exc:
        if str(exc) == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        raise HTTPException(status_code=404, detail="Template not found") from exc
