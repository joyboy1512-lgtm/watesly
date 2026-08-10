from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.schemas.template import TemplateCreateRequest
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.meta_template_submit import normalize_template_name, submit_template_to_meta


def _meta_error_message(exc: MetaAPIError) -> str:
    if isinstance(exc.response_data, dict):
        error = exc.response_data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if exc.response_data.get("message"):
            return str(exc.response_data["message"])
    return str(exc)


async def create_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: TemplateCreateRequest,
) -> WhatsAppTemplate:
    wa = await db.get(WhatsAppAccount, payload.whatsapp_account_id)
    if wa is None or wa.account_id != account_id:
        raise ValueError("INVALID_WHATSAPP_ACCOUNT")

    normalized_name = normalize_template_name(payload.name)
    data = payload.model_dump()
    data["name"] = normalized_name
    template = WhatsAppTemplate(
        account_id=account_id,
        organization_id=wa.organization_id,
        status=TemplateStatus.DRAFT,
        **data,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    try:
        template = await submit_template_to_meta(
            db,
            account_id=account_id,
            template_id=template.id,
        )
    except MetaAPIError as exc:
        template.status = TemplateStatus.REJECTED
        template.meta_status_detail = _meta_error_message(exc)[:4000]
        await db.commit()
        await db.refresh(template)

    return template


async def resubmit_template_to_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
) -> WhatsAppTemplate:
    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("TEMPLATE_NOT_FOUND")
    if template.status == TemplateStatus.APPROVED:
        raise ValueError("TEMPLATE_ALREADY_APPROVED")

    try:
        return await submit_template_to_meta(
            db,
            account_id=account_id,
            template_id=template_id,
        )
    except MetaAPIError as exc:
        template.status = TemplateStatus.REJECTED
        template.meta_status_detail = _meta_error_message(exc)[:4000]
        await db.commit()
        await db.refresh(template)
        raise ValueError("META_SUBMIT_FAILED") from exc


async def list_templates(db: AsyncSession, account_id: UUID) -> list[WhatsAppTemplate]:
    result = await db.execute(
        select(WhatsAppTemplate)
        .where(WhatsAppTemplate.account_id == account_id)
        .order_by(WhatsAppTemplate.created_at.desc())
    )
    templates = list(result.scalars().all())
    await refresh_pending_template_statuses(db, account_id=account_id, templates=templates)
    return templates


async def refresh_pending_template_statuses(
    db: AsyncSession,
    *,
    account_id: UUID,
    templates: list[WhatsAppTemplate] | None = None,
) -> int:
    """Pull latest Meta status for pending templates (fallback when webhooks lag)."""
    rows = templates
    if rows is None:
        result = await db.execute(
            select(WhatsAppTemplate).where(
                WhatsAppTemplate.account_id == account_id,
                WhatsAppTemplate.status == TemplateStatus.PENDING,
            )
        )
        rows = list(result.scalars().all())
    else:
        rows = [item for item in rows if item.status == TemplateStatus.PENDING]

    if not rows:
        return 0

    by_account: dict[UUID, list[WhatsAppTemplate]] = {}
    for item in rows:
        by_account.setdefault(item.whatsapp_account_id, []).append(item)

    updated = 0
    for whatsapp_account_id, pending_items in by_account.items():
        wa = await db.get(WhatsAppAccount, whatsapp_account_id)
        if wa is None or wa.account_id != account_id:
            continue
        client = MetaWhatsAppClient(
            access_token=decrypt_secret(wa.access_token_encrypted),
            phone_number_id=wa.phone_number_id,
        )
        try:
            response = await client.list_templates(waba_id=wa.waba_id, limit=250)
        except MetaAPIError:
            continue
        finally:
            await client.aclose()

        meta_index = {
            (str(item.get("name", "")), str(item.get("language", ""))): item
            for item in response.get("data", [])
            if item.get("name") and item.get("language")
        }
        for template in pending_items:
            key = (template.name, template.language)
            meta_item = meta_index.get(key)
            if meta_item is None:
                continue
            raw_status = str(meta_item.get("status", template.status.value)).lower()
            try:
                new_status = TemplateStatus(raw_status)
            except ValueError:
                continue
            if new_status == template.status and template.meta_template_id:
                continue
            template.status = new_status
            if meta_item.get("id"):
                template.meta_template_id = str(meta_item["id"])
            if new_status == TemplateStatus.APPROVED:
                template.meta_status_detail = None
            updated += 1

    if updated:
        await db.commit()
    return updated


async def sync_templates_from_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
) -> tuple[int, int]:
    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != account_id:
        raise ValueError("INVALID_WHATSAPP_ACCOUNT")

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    response = await client.list_templates(waba_id=wa.waba_id)

    created = updated = 0
    for item in response.get("data", []):
        name = item.get("name")
        language = item.get("language")
        if not name or not language:
            continue

        result = await db.execute(
            select(WhatsAppTemplate).where(
                WhatsAppTemplate.whatsapp_account_id == wa.id,
                WhatsAppTemplate.name == name,
                WhatsAppTemplate.language == language,
            )
        )
        template = result.scalar_one_or_none()

        raw_category = str(item.get("category", "UTILITY")).lower()
        raw_status = str(item.get("status", "PENDING")).lower()

        if template is None:
            template = WhatsAppTemplate(
                account_id=account_id,
                organization_id=wa.organization_id,
                whatsapp_account_id=wa.id,
                meta_template_id=str(item.get("id")) if item.get("id") else None,
                name=name,
                language=language,
                category=raw_category,
                status=raw_status,
                body_text=None,
                components=item.get("components", []),
            )
            db.add(template)
            created += 1
        else:
            template.meta_template_id = str(item.get("id")) if item.get("id") else template.meta_template_id
            template.category = raw_category
            template.status = raw_status
            template.components = item.get("components", [])
            updated += 1

    await db.commit()
    return created, updated


async def update_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
    payload,
) -> WhatsAppTemplate:
    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("TEMPLATE_NOT_FOUND")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(template, key, value)
    await db.commit()
    await db.refresh(template)
    return template


async def delete_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
) -> None:
    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("TEMPLATE_NOT_FOUND")
    await db.delete(template)
    await db.commit()
