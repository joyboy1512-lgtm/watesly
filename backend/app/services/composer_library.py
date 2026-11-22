from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.composer_library import ComposerButtonTemplate, ComposerListTemplate
from app.models.organization import Organization
from app.schemas.composer_library import (
    ComposerButtonTemplateCreate,
    ComposerButtonTemplateUpdate,
    ComposerListTemplateCreate,
    ComposerListTemplateUpdate,
)


async def _ensure_org(db: AsyncSession, *, account_id: UUID, organization_id: UUID, membership=None) -> None:
    from app.services.membership_access import ensure_membership_organization_access

    organization = await db.get(Organization, organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    if membership is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=organization_id,
        )


async def list_button_templates(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID | None = None,
    membership=None,
) -> list[ComposerButtonTemplate]:
    from app.services.membership_access import organization_scope_clauses

    query = select(ComposerButtonTemplate).where(
        ComposerButtonTemplate.account_id == account_id,
        ComposerButtonTemplate.is_active.is_(True),
    )
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=ComposerButtonTemplate.organization_id,
        ):
            query = query.where(clause)
    if organization_id is not None:
        query = query.where(ComposerButtonTemplate.organization_id == organization_id)
    query = query.order_by(ComposerButtonTemplate.name.asc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_button_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    payload: ComposerButtonTemplateCreate,
    membership=None,
) -> ComposerButtonTemplate:
    await _ensure_org(
        db, account_id=account_id, organization_id=payload.organization_id, membership=membership
    )
    item = ComposerButtonTemplate(
        account_id=account_id,
        organization_id=payload.organization_id,
        created_by_user_id=user_id,
        name=payload.name.strip(),
        body=payload.body.strip(),
        titles=payload.titles.strip(),
        is_active=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_button_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
    payload: ComposerButtonTemplateUpdate,
    membership=None,
) -> ComposerButtonTemplate:
    item = await db.get(ComposerButtonTemplate, template_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOT_FOUND")
    await _ensure_org(
        db, account_id=account_id, organization_id=item.organization_id, membership=membership
    )
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"].strip()
    if "body" in updates and updates["body"] is not None:
        updates["body"] = updates["body"].strip()
    if "titles" in updates and updates["titles"] is not None:
        updates["titles"] = updates["titles"].strip()
    for key, value in updates.items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def archive_button_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
    membership=None,
) -> ComposerButtonTemplate:
    item = await db.get(ComposerButtonTemplate, template_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOT_FOUND")
    await _ensure_org(
        db, account_id=account_id, organization_id=item.organization_id, membership=membership
    )
    item.is_active = False
    await db.commit()
    await db.refresh(item)
    return item


async def list_list_templates(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID | None = None,
    membership=None,
) -> list[ComposerListTemplate]:
    from app.services.membership_access import organization_scope_clauses

    query = select(ComposerListTemplate).where(
        ComposerListTemplate.account_id == account_id,
        ComposerListTemplate.is_active.is_(True),
    )
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=ComposerListTemplate.organization_id,
        ):
            query = query.where(clause)
    if organization_id is not None:
        query = query.where(ComposerListTemplate.organization_id == organization_id)
    query = query.order_by(ComposerListTemplate.name.asc())
    result = await db.execute(query)
    return list(result.scalars().all())


def _normalize_sections(sections: list) -> list[dict]:
    normalized: list[dict] = []
    for section in sections[:10]:
        title = (section.title if hasattr(section, "title") else section.get("title", "")).strip()[:24]
        rows_text = (
            section.rows_text if hasattr(section, "rows_text") else section.get("rows_text", "")
        ).strip()
        if not rows_text:
            continue
        normalized.append({"title": title or "خيارات", "rows_text": rows_text})
    return normalized


async def create_list_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    payload: ComposerListTemplateCreate,
    membership=None,
) -> ComposerListTemplate:
    await _ensure_org(
        db, account_id=account_id, organization_id=payload.organization_id, membership=membership
    )
    sections = _normalize_sections(payload.sections)
    if not sections:
        raise ValueError("EMPTY_SECTIONS")
    item = ComposerListTemplate(
        account_id=account_id,
        organization_id=payload.organization_id,
        created_by_user_id=user_id,
        name=payload.name.strip(),
        body=payload.body.strip(),
        button_text=payload.button_text.strip()[:20] or "القائمة",
        sections_json=sections,
        is_active=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_list_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
    payload: ComposerListTemplateUpdate,
    membership=None,
) -> ComposerListTemplate:
    item = await db.get(ComposerListTemplate, template_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOT_FOUND")
    await _ensure_org(
        db, account_id=account_id, organization_id=item.organization_id, membership=membership
    )
    updates = payload.model_dump(exclude_unset=True)
    if "sections" in updates and updates["sections"] is not None:
        sections = _normalize_sections(updates.pop("sections"))
        if not sections:
            raise ValueError("EMPTY_SECTIONS")
        item.sections_json = sections
    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"].strip()
    if "body" in updates and updates["body"] is not None:
        updates["body"] = updates["body"].strip()
    if "button_text" in updates and updates["button_text"] is not None:
        updates["button_text"] = updates["button_text"].strip()[:20]
    for key, value in updates.items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def archive_list_template(
    db: AsyncSession,
    *,
    account_id: UUID,
    template_id: UUID,
    membership=None,
) -> ComposerListTemplate:
    item = await db.get(ComposerListTemplate, template_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOT_FOUND")
    await _ensure_org(
        db, account_id=account_id, organization_id=item.organization_id, membership=membership
    )
    item.is_active = False
    await db.commit()
    await db.refresh(item)
    return item
