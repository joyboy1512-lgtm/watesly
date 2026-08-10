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


def _merge_template_components(existing: list | None, incoming: list | None) -> list:
    """Keep stable header media_url when Meta sync omits or replaces it with expiring CDN handles."""
    incoming_components = list(incoming or [])
    if not existing:
        return incoming_components

    preserved_media: dict[str, str] = {}
    preserved_filename: dict[str, str | None] = {}
    for component in existing:
        if str(component.get("type", "")).upper() != "HEADER":
            continue
        header_format = str(component.get("format", "")).upper()
        media_url = component.get("media_url") or component.get("url")
        if header_format and media_url and not str(media_url).startswith("https://scontent.whatsapp.net"):
            preserved_media[header_format] = str(media_url)
            preserved_filename[header_format] = component.get("filename")

    if not preserved_media:
        return incoming_components

    merged: list[dict] = []
    for component in incoming_components:
        item = dict(component)
        if str(item.get("type", "")).upper() == "HEADER":
            header_format = str(item.get("format", "")).upper()
            if header_format in preserved_media and not item.get("media_url"):
                item["media_url"] = preserved_media[header_format]
                if preserved_filename.get(header_format) and not item.get("filename"):
                    item["filename"] = preserved_filename[header_format]
        merged.append(item)
    return merged


async def create_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: TemplateCreateRequest,
    membership=None,
) -> WhatsAppTemplate:
    from app.services.membership_access import ensure_whatsapp_account_access

    if membership is not None:
        wa = await ensure_whatsapp_account_access(
            db,
            account_id=account_id,
            membership=membership,
            whatsapp_account_id=payload.whatsapp_account_id,
        )
    else:
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


def _status_str(status: TemplateStatus | str) -> str:
    return status.value if isinstance(status, TemplateStatus) else str(status)


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
            response = await client.list_all_templates(waba_id=wa.waba_id)
        except MetaAPIError:
            continue
        finally:
            await client.aclose()

        meta_index = {
            (str(item.get("name", "")), str(item.get("language", ""))): item
            for item in response
            if item.get("name") and item.get("language")
        }
        for template in pending_items:
            key = (template.name, template.language)
            meta_item = meta_index.get(key)
            if meta_item is None:
                continue
            raw_status = str(meta_item.get("status", _status_str(template.status))).lower()
            try:
                new_status = TemplateStatus(raw_status)
            except ValueError:
                continue
            if new_status == template.status or _status_str(new_status) == _status_str(template.status):
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


async def list_templates(
    db: AsyncSession,
    account_id: UUID,
    *,
    membership=None,
) -> list[WhatsAppTemplate]:
    from app.services.membership_access import template_list_filters

    query = select(WhatsAppTemplate).where(WhatsAppTemplate.account_id == account_id)
    if membership is not None:
        for clause in await template_list_filters(
            db, account_id=account_id, membership=membership
        ):
            query = query.where(clause)
    query = query.order_by(WhatsAppTemplate.created_at.desc())

    result = await db.execute(query)
    templates = list(result.scalars().all())
    await refresh_pending_template_statuses(db, account_id=account_id, templates=templates)
    return templates


async def sync_templates_from_meta(
    db: AsyncSession,
    *,
    account_id: UUID,
    whatsapp_account_id: UUID,
    membership=None,
) -> tuple[int, int]:
    from app.services.membership_access import ensure_whatsapp_account_access

    if membership is not None:
        wa = await ensure_whatsapp_account_access(
            db,
            account_id=account_id,
            membership=membership,
            whatsapp_account_id=whatsapp_account_id,
        )
    else:
        wa = await db.get(WhatsAppAccount, whatsapp_account_id)
        if wa is None or wa.account_id != account_id:
            raise ValueError("INVALID_WHATSAPP_ACCOUNT")

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(wa.access_token_encrypted),
        phone_number_id=wa.phone_number_id,
    )
    try:
        response_items = await client.list_all_templates(waba_id=wa.waba_id)
    finally:
        await client.aclose()

    created = updated = 0
    for item in response_items:
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
            template.components = _merge_template_components(
                template.components,
                item.get("components", []),
            )
            updated += 1

    await db.commit()
    return created, updated


async def update_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
    payload,
    membership=None,
) -> WhatsAppTemplate:
    from app.services.membership_access import ensure_template_access

    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("TEMPLATE_NOT_FOUND")
    if membership is not None:
        await ensure_template_access(
            db, account_id=account_id, membership=membership, template=template
        )
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
    membership=None,
) -> None:
    from app.services.membership_access import ensure_template_access

    template = await db.get(WhatsAppTemplate, template_id)
    if template is None or template.account_id != account_id:
        raise ValueError("TEMPLATE_NOT_FOUND")
    if membership is not None:
        await ensure_template_access(
            db, account_id=account_id, membership=membership, template=template
        )
    if template.meta_template_id:
        wa = await db.get(WhatsAppAccount, template.whatsapp_account_id)
        if wa is not None and wa.account_id == account_id:
            client = MetaWhatsAppClient(
                access_token=decrypt_secret(wa.access_token_encrypted),
                phone_number_id=wa.phone_number_id,
            )
            try:
                await client.delete_message_template(
                    waba_id=wa.waba_id,
                    template_name=template.name,
                )
            except MetaAPIError:
                pass
            finally:
                await client.aclose()
    await db.delete(template)
    await db.commit()
