from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.contact import Contact
from app.models.contact_interest import ContactInterest
from app.models.contact_tag import ContactTag
from app.models.segment import Segment
from app.models.tag import Tag
from app.schemas.contact import ContactCreateRequest
from app.services.contact_management import _apply_segment_filters, apply_contact_tags
from app.services.interests import apply_contact_interests
from app.services.gender_inference import infer_gender_from_name, infer_gender_with_llm_fallback
from app.services.phone_normalize import normalize_whatsapp_phone, phones_match

_LIST_LIMIT_MAX = 5000


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


def _merge_uuid_filters(
    singular: UUID | None,
    plural: list[UUID] | None,
) -> list[UUID]:
    values: list[UUID] = []
    if plural:
        values.extend(plural)
    if singular is not None and singular not in values:
        values.append(singular)
    return values


def _whatsapp_status_clause(statuses: list[str]):
    from app.services.contact_reachability import ReachabilityStatus

    clauses = []
    for status in statuses:
        key = status.strip().lower()
        if key == "dnd":
            clauses.append(Contact.marketing_opt_in.is_(False))
        elif key == "unreachable":
            clauses.append(
                (Contact.marketing_opt_in.is_(True))
                & (Contact.reachability_status == ReachabilityStatus.UNREACHABLE)
            )
        elif key == "invalid":
            clauses.append(
                (Contact.marketing_opt_in.is_(True))
                & (Contact.reachability_status == ReachabilityStatus.INVALID)
            )
        elif key == "reachable":
            clauses.append(
                (Contact.marketing_opt_in.is_(True))
                & (Contact.reachability_status == ReachabilityStatus.REACHABLE)
            )
        elif key == "accepts":
            clauses.append(
                (Contact.marketing_opt_in.is_(True))
                & (
                    (Contact.reachability_status.is_(None))
                    | (Contact.reachability_status == ReachabilityStatus.RISKY)
                )
            )
    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return or_(*clauses)


async def list_contacts(
    db: AsyncSession,
    account_id: UUID,
    *,
    limit: int = 100,
    channel_id: UUID | None = None,
    channel_ids: list[UUID] | None = None,
    organization_id: UUID | None = None,
    organization_ids: list[UUID] | None = None,
    tag_id: UUID | None = None,
    tag_ids: list[UUID] | None = None,
    interest_id: UUID | None = None,
    interest_ids: list[UUID] | None = None,
    segment_id: UUID | None = None,
    lifecycle_stage: str | None = None,
    lifecycle_stages: list[str] | None = None,
    region: str | None = None,
    regions: list[str] | None = None,
    whatsapp_status: str | None = None,
    whatsapp_statuses: list[str] | None = None,
    last_campaign_ids: list[UUID] | None = None,
    contact_ids: list[UUID] | None = None,
    q: str | None = None,
    accessible_channel_ids: list[UUID] | None = None,
    accessible_organization_ids: list[UUID] | None = None,
) -> list[Contact]:
    effective_tag_ids = _merge_uuid_filters(tag_id, tag_ids)
    effective_interest_ids = _merge_uuid_filters(interest_id, interest_ids)
    effective_org_ids = _merge_uuid_filters(organization_id, organization_ids)
    effective_channel_ids = _merge_uuid_filters(channel_id, channel_ids)
    effective_regions: list[str] = []
    if regions:
        effective_regions.extend([item.strip() for item in regions if item and item.strip()])
    if region and region.strip() and region.strip() not in effective_regions:
        effective_regions.append(region.strip())
    effective_lifecycle: list[str] = []
    if lifecycle_stages:
        effective_lifecycle.extend([item.strip() for item in lifecycle_stages if item and item.strip()])
    if lifecycle_stage and lifecycle_stage.strip() and lifecycle_stage.strip() not in effective_lifecycle:
        effective_lifecycle.append(lifecycle_stage.strip())
    effective_whatsapp: list[str] = []
    if whatsapp_statuses:
        effective_whatsapp.extend([item.strip().lower() for item in whatsapp_statuses if item and item.strip()])
    if whatsapp_status and whatsapp_status.strip():
        value = whatsapp_status.strip().lower()
        if value not in effective_whatsapp:
            effective_whatsapp.append(value)

    query = (
        select(Contact)
        .where(Contact.account_id == account_id, Contact.deleted_at.is_(None))
        .order_by(Contact.created_at.desc(), Contact.updated_at.desc())
        .limit(min(max(limit, 1), _LIST_LIMIT_MAX))
    )
    if contact_ids is not None:
        if not contact_ids:
            return []
        query = query.where(Contact.id.in_(contact_ids))
    if segment_id is not None:
        segment = await db.get(Segment, segment_id)
        if segment is not None and segment.account_id == account_id:
            filters = dict(segment.filter_json or {})
            if len(effective_channel_ids) == 1:
                filters["channel_id"] = str(effective_channel_ids[0])
            elif len(effective_channel_ids) > 1:
                filters["channel_ids"] = [str(item) for item in effective_channel_ids]
            if len(effective_org_ids) == 1:
                filters["organization_id"] = str(effective_org_ids[0])
            elif len(effective_org_ids) > 1:
                filters["organization_ids"] = [str(item) for item in effective_org_ids]
            if len(effective_tag_ids) == 1:
                filters["tag_id"] = str(effective_tag_ids[0])
            elif len(effective_tag_ids) > 1:
                filters["tag_ids"] = [str(item) for item in effective_tag_ids]
            if len(effective_interest_ids) == 1:
                filters["interest_id"] = str(effective_interest_ids[0])
            elif len(effective_interest_ids) > 1:
                filters["interest_ids"] = [str(item) for item in effective_interest_ids]
            if len(effective_regions) == 1:
                filters["region"] = effective_regions[0]
            elif len(effective_regions) > 1:
                filters["regions"] = effective_regions
            if len(effective_lifecycle) == 1:
                filters["lifecycle_stage"] = effective_lifecycle[0]
            elif len(effective_lifecycle) > 1:
                filters["lifecycle_stages"] = effective_lifecycle
            if q and q.strip():
                filters["search"] = q.strip()
            query = _apply_segment_filters(query, filters)
            query = query.distinct()
        else:
            return []
    else:
        if accessible_organization_ids is not None:
            if not accessible_organization_ids:
                return []
            query = query.where(Contact.organization_id.in_(accessible_organization_ids))
        if effective_channel_ids:
            query = query.where(Contact.channel_id.in_(effective_channel_ids))
        elif accessible_channel_ids is not None:
            if not accessible_channel_ids:
                return []
            query = query.where(Contact.channel_id.in_(accessible_channel_ids))
        if effective_org_ids:
            query = query.where(Contact.organization_id.in_(effective_org_ids))
        if len(effective_tag_ids) == 1:
            query = query.where(
                exists().where(
                    ContactTag.contact_id == Contact.id,
                    ContactTag.tag_id == effective_tag_ids[0],
                )
            )
        elif len(effective_tag_ids) > 1:
            query = query.where(
                exists().where(
                    ContactTag.contact_id == Contact.id,
                    ContactTag.tag_id.in_(effective_tag_ids),
                )
            )
        if len(effective_interest_ids) == 1:
            query = query.where(
                exists().where(
                    ContactInterest.contact_id == Contact.id,
                    ContactInterest.interest_id == effective_interest_ids[0],
                )
            )
        elif len(effective_interest_ids) > 1:
            query = query.where(
                exists().where(
                    ContactInterest.contact_id == Contact.id,
                    ContactInterest.interest_id.in_(effective_interest_ids),
                )
            )
        if len(effective_lifecycle) == 1:
            query = query.where(Contact.lifecycle_stage == effective_lifecycle[0])
        elif len(effective_lifecycle) > 1:
            query = query.where(Contact.lifecycle_stage.in_(effective_lifecycle))
        if len(effective_regions) == 1:
            query = query.where(Contact.region == effective_regions[0])
        elif len(effective_regions) > 1:
            query = query.where(Contact.region.in_(effective_regions))
        if q and q.strip():
            term = f"%{q.strip()}%"
            query = query.where(
                or_(
                    Contact.display_name.ilike(term),
                    Contact.external_address.ilike(term),
                    Contact.email.ilike(term),
                    Contact.region.ilike(term),
                )
            )
        status_clause = _whatsapp_status_clause(effective_whatsapp)
        if status_clause is not None:
            query = query.where(status_clause)

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

    if effective_whatsapp:
        from app.services.contact_reachability import resolve_whatsapp_contact_status

        allowed = set(effective_whatsapp)
        contacts = [
            contact
            for contact in contacts
            if resolve_whatsapp_contact_status(contact).value in allowed
        ]

    if last_campaign_ids:
        from app.services.contact_campaign_groups import load_last_campaigns_for_contacts

        last_map = await load_last_campaigns_for_contacts(
            db,
            account_id=account_id,
            contact_ids=[item.id for item in contacts],
        )
        wanted = set(last_campaign_ids)
        contacts = [
            contact
            for contact in contacts
            if last_map.get(contact.id, {}).get("last_campaign_id") in wanted
        ]

    return contacts


async def list_contact_regions(
    db: AsyncSession,
    account_id: UUID,
    *,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
    accessible_channel_ids: list[UUID] | None = None,
    accessible_organization_ids: list[UUID] | None = None,
) -> list[dict]:
    query = (
        select(Contact.region, func.count(Contact.id))
        .where(
            Contact.account_id == account_id,
            Contact.deleted_at.is_(None),
            Contact.region.is_not(None),
            Contact.region != "",
        )
        .group_by(Contact.region)
        .order_by(Contact.region.asc())
    )
    if accessible_organization_ids is not None:
        if not accessible_organization_ids:
            return []
        query = query.where(Contact.organization_id.in_(accessible_organization_ids))
    if organization_id is not None:
        query = query.where(Contact.organization_id == organization_id)
    if channel_id is not None:
        query = query.where(Contact.channel_id == channel_id)
    elif accessible_channel_ids is not None:
        if not accessible_channel_ids:
            return []
        query = query.where(Contact.channel_id.in_(accessible_channel_ids))
    rows = (await db.execute(query)).all()
    return [{"region": name, "count": int(count)} for name, count in rows if name]


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
        if payload.region is not None:
            contact.region = payload.region
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
