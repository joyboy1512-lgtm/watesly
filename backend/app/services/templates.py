from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import WhatsAppTemplate
from app.schemas.template import TemplateCreateRequest
from app.services.meta_client import MetaWhatsAppClient


async def create_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: TemplateCreateRequest,
) -> WhatsAppTemplate:
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


async def list_templates(db: AsyncSession, account_id: UUID) -> list[WhatsAppTemplate]:
    result = await db.execute(
        select(WhatsAppTemplate)
        .where(WhatsAppTemplate.account_id == account_id)
        .order_by(WhatsAppTemplate.created_at.desc())
    )
    return list(result.scalars().all())


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
