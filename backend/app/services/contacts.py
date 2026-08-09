from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.segment import Segment
from app.models.tag import Tag
from app.schemas.contact import ContactCreateRequest
from app.services.contact_management import _apply_segment_filters, apply_contact_tags
from app.services.interests import apply_contact_interests
from app.services.gender_inference import infer_gender_from_name, infer_gender_with_llm_fallback
from app.services.phone_normalize import normalize_whatsapp_phone, phones_match

_LIST_LIMIT_MAX = 500


async def find_contact_on_channel_by_phone(
    db: AsyncSession,
    *,
    organization_id: UUID,
    channel_id: UUID,
    external_address: str,
    country_code: str = "965",
) -> Contact | None:
    normalized = normalize_whatsapp_phone(external_address, country_code=country_code)
    if not normalized:
        return None
    result = await db.execute(
        select(Contact).where(
            Contact.organization_id == organization_id,
            Contact.channel_id == channel_id,
            Contact.deleted_at.is_(None),
        )
    )
    for contact in result.scalars().all():
        if phones_match(contact.external_address, normalized, country_code=country_code):
            return contact
    return None


async def list_contacts(
    db: AsyncSession,
    account_id: UUID,
    *,
    limit: int = 100,
    channel_id: UUID | None = None,
    organization_id: UUID | None = None,
    tag_id: UUID | None = None,
    segment_id: UUID | None = None,
    lifecycle_stage: str | None = None,
    q: str | None = None,
) -> list[Contact]:
    query = (
        select(Contact)
        .where(Contact.account_id == account_id, Contact.deleted_at.is_(None))
        .order_by(Contact.created_at.desc(), Contact.updated_at.desc())
        .limit(min(max(limit, 1), _LIST_LIMIT_MAX))
    )
    if segment_id is not None:
        segment = await db.get(Segment, segment_id)
        if segment is not None and segment.account_id == account_id:
            filters = dict(segment.filter_json or {})
            if channel_id is not None:
                filters["channel_id"] = str(channel_id)
            if organization_id is not None:
                filters["organization_id"] = str(organization_id)
            if tag_id is not None:
                filters["tag_id"] = str(tag_id)
            if q and q.strip():
                filters["search"] = q.strip()
            query = _apply_segment_filters(query, filters)
            query = query.distinct()
        else:
            return []
    else:
        if channel_id is not None:
            query = query.where(Contact.channel_id == channel_id)
        if organization_id is not None:
            query = query.where(Contact.organization_id == organization_id)
        if tag_id is not None:
            query = query.where(
                exists().where(
                    ContactTag.contact_id == Contact.id,
                    ContactTag.tag_id == tag_id,
                )
            )
        if lifecycle_stage and lifecycle_stage.strip():
            query = query.where(Contact.lifecycle_stage == lifecycle_stage.strip())
        if q and q.strip():
            term = f"%{q.strip()}%"
            query = query.where(
                or_(
                    Contact.display_name.ilike(term),
                    Contact.external_address.ilike(term),
                    Contact.email.ilike(term),
                )
            )

    contacts = list((await db.execute(query)).scalars().all())

    backfill_needed = False
    for contact in contacts:
        if contact.gender == "unknown" and contact.display_name:
            contact.gender = infer_gender_from_name(contact.display_name)
            if contact.gender != "unknown":
                backfill_needed = True
    if backfill_needed:
        await db.commit()
        for contact in contacts:
            await db.refresh(contact)

    return contacts


async def create_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: ContactCreateRequest,
) -> Contact:
    channel = await db.get(Channel, payload.channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("INVALID_CHANNEL")
    if channel.organization_id != payload.organization_id:
        raise ValueError("CHANNEL_ORGANIZATION_MISMATCH")

    country_code = (payload.country_code or "965").strip() or "965"
    normalized_address = normalize_whatsapp_phone(payload.external_address, country_code=country_code)
    if not normalized_address:
        raise ValueError("INVALID_PHONE")

    gender = await infer_gender_with_llm_fallback(payload.display_name)
    lifecycle_stage = None
    if payload.lifecycle_stage and payload.lifecycle_stage.strip():
        lifecycle_stage = payload.lifecycle_stage.strip()[:30]

    contact = await find_contact_on_channel_by_phone(
        db,
        organization_id=payload.organization_id,
        channel_id=payload.channel_id,
        external_address=normalized_address,
        country_code=country_code,
    )
    if contact is not None:
        if contact.external_address != normalized_address:
            contact.external_address = normalized_address
        if payload.display_name is not None:
            contact.display_name = payload.display_name
            contact.gender = await infer_gender_with_llm_fallback(payload.display_name)
        if payload.email is not None:
            contact.email = payload.email
        if payload.language is not None:
            contact.language = payload.language
        if payload.country_code is not None:
            contact.country_code = payload.country_code
        if lifecycle_stage is not None:
            contact.lifecycle_stage = lifecycle_stage
        contact.updated_at = datetime.now(UTC)
        await apply_contact_tags(
            db,
            account_id=account_id,
            contact_id=contact.id,
            tag_ids=payload.tag_ids,
        )
        await apply_contact_interests(
            db,
            account_id=account_id,
            contact_id=contact.id,
            interest_ids=payload.interest_ids,
        )
        await db.commit()
        await db.refresh(contact)
        return contact

    data = payload.model_dump(exclude={"tag_ids", "interest_ids"})
    data["external_address"] = normalized_address
    data["gender"] = gender
    if lifecycle_stage is not None:
        data["lifecycle_stage"] = lifecycle_stage
    contact = Contact(account_id=account_id, **data)
    db.add(contact)
    await db.flush()
    await apply_contact_tags(
        db,
        account_id=account_id,
        contact_id=contact.id,
        tag_ids=payload.tag_ids,
    )
    await apply_contact_interests(
        db,
        account_id=account_id,
        contact_id=contact.id,
        interest_ids=payload.interest_ids,
    )
    await db.commit()
    await db.refresh(contact)
    return contact
