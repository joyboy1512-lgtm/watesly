from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import WhatsAppTemplate
from app.schemas.template import TemplateCreateRequest
from app.services.meta_client import MetaWhatsAppClient


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
    template = WhatsAppTemplate(
        account_id=account_id,
        organization_id=wa.organization_id,
        **payload.model_dump(),
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


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
    return list(result.scalars().all())


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
    await db.delete(template)
    await db.commit()
