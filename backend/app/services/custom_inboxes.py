from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.custom_inbox import CustomInbox
from app.models.organization import Organization
from app.schemas.custom_inbox import (
    CustomInboxCreateRequest,
    CustomInboxFilters,
    CustomInboxResponse,
    CustomInboxUpdateRequest,
)


def _to_response(item: CustomInbox) -> CustomInboxResponse:
    filters_raw = item.filters_json or {}
    return CustomInboxResponse(
        id=item.id,
        account_id=item.account_id,
        organization_id=item.organization_id,
        created_by_membership_id=item.created_by_membership_id,
        name=item.name,
        description=item.description,
        filters=CustomInboxFilters.model_validate(filters_raw),
    )


async def list_custom_inboxes(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID | None = None,
) -> list[CustomInboxResponse]:
    query = select(CustomInbox).where(CustomInbox.account_id == account_id).order_by(CustomInbox.created_at.asc())
    if organization_id is not None:
        query = query.where(
            (CustomInbox.organization_id.is_(None)) | (CustomInbox.organization_id == organization_id)
        )
    rows = list((await db.execute(query)).scalars().all())
    return [_to_response(item) for item in rows]


async def create_custom_inbox(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_id: UUID | None,
    payload: CustomInboxCreateRequest,
) -> CustomInboxResponse:
    if payload.organization_id is not None:
        organization = await db.get(Organization, payload.organization_id)
        if organization is None or organization.account_id != account_id:
            raise ValueError("INVALID_ORGANIZATION")
    item = CustomInbox(
        account_id=account_id,
        organization_id=payload.organization_id,
        created_by_membership_id=membership_id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        filters_json=payload.filters.model_dump(mode="json"),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _to_response(item)


async def update_custom_inbox(
    db: AsyncSession,
    *,
    account_id: UUID,
    inbox_id: UUID,
    payload: CustomInboxUpdateRequest,
) -> CustomInboxResponse:
    item = await db.get(CustomInbox, inbox_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOT_FOUND")
    if payload.name is not None:
        item.name = payload.name.strip()
    if payload.description is not None:
        item.description = payload.description.strip() or None
    if payload.filters is not None:
        item.filters_json = payload.filters.model_dump(mode="json")
    await db.commit()
    await db.refresh(item)
    return _to_response(item)


async def delete_custom_inbox(
    db: AsyncSession,
    *,
    account_id: UUID,
    inbox_id: UUID,
) -> None:
    item = await db.get(CustomInbox, inbox_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOT_FOUND")
    await db.delete(item)
    await db.commit()
