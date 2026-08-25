import csv
import io
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.contact import Contact
from app.models.contact_interest import ContactInterest
from app.models.contact_tag import ContactTag
from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_note import ConversationNote
from app.models.custom_field import CustomFieldDefinition, CustomFieldValue
from app.models.message import Message
from app.models.organization import Organization
from app.models.segment import Segment
from app.models.tag import Tag
from app.schemas.contact import ContactCreateRequest
from app.services.contact_reachability import ReachabilityStatus
from app.services.gender_inference import infer_gender_with_llm_fallback

CONTACT_EXPORT_HEADERS = [
    "phone",
    "name",
    "email",
    "language",
    "country_code",
    "gender",
    "salutation",
    "organization",
    "channel",
    "tags",
    "created_at",
]

CONTACT_IMPORT_TEMPLATE_HEADERS = [
    "phone",
    "name",
    "email",
    "language",
    "country_code",
]

INTENT_TAG_CANDIDATES: dict[str, list[str]] = {
    "purchase": ["شراء", "طلب", "purchase", "مهتم", "order", "buy", "اشتري", "أشتري"],
    "cancellation": ["إلغاء", "استرداد", "cancellation", "refund", "cancel"],
    "question": ["استفسار", "سؤال", "question", "inquiry"],
    "quote": ["عرض سعر", "quote", "تسعير", "pricing", "price", "سعر", "كم السعر"],
    "complaint": ["شكوى", "complaint", "مشكلة", "problem", "issue", "غير راض"],
    "frustrated": ["شكوى", "غير راض", "complaint", "زعلان", "غاضب"],
    "positive": ["راض", "شكر", "positive", "ممتاز", "thanks", "thank"],
}


def gender_salutation(gender: str | None) -> str:
    if gender == "male":
        return "سيد"
    if gender == "female":
        return "سيدة"
    return ""


async def get_contact_or_raise(db: AsyncSession, *, account_id: UUID, contact_id: UUID) -> Contact:
    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id or contact.deleted_at is not None:
        raise ValueError("CONTACT_NOT_FOUND")
    return contact


async def update_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    display_name: str | None = None,
    email: str | None = None,
    language: str | None = None,
    country_code: str | None = None,
    marketing_opt_in: bool | None = None,
    lifecycle_stage: str | None = None,
) -> Contact:
    contact = await get_contact_or_raise(db, account_id=account_id, contact_id=contact_id)
    if display_name is not None:
        contact.display_name = display_name
        contact.gender = await infer_gender_with_llm_fallback(display_name)
    if email is not None:
        contact.email = email
    if language is not None:
        contact.language = language
    if country_code is not None:
        contact.country_code = country_code
    if marketing_opt_in is not None:
        contact.marketing_opt_in = marketing_opt_in
    if lifecycle_stage is not None:
        contact.lifecycle_stage = lifecycle_stage.strip()[:30] or "lead"
    contact.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(contact)
    return contact


async def delete_contact(db: AsyncSession, *, account_id: UUID, contact_id: UUID) -> None:
    from datetime import UTC, datetime

    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")
    contact.deleted_at = datetime.now(UTC)
    await db.commit()


async def apply_contact_tags(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    tag_ids: list[UUID],
) -> None:
    if not tag_ids:
        return
    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")
    result = await db.execute(select(Tag.id).where(Tag.account_id == account_id, Tag.id.in_(tag_ids)))
    valid_ids = set(result.scalars().all())
    if valid_ids != set(tag_ids):
        raise ValueError("INVALID_TAG")
    existing = (
        await db.execute(
            select(ContactTag.tag_id).where(ContactTag.contact_id == contact_id, ContactTag.tag_id.in_(valid_ids))
        )
    ).scalars().all()
    existing_ids = set(existing)
    for tag_id in valid_ids:
        if tag_id not in existing_ids:
            db.add(ContactTag(contact_id=contact_id, tag_id=tag_id))


async def add_contact_tag(db: AsyncSession, *, account_id: UUID, contact_id: UUID, tag_id: UUID) -> None:
    contact = await db.get(Contact, contact_id)
    tag = await db.get(Tag, tag_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")
    if tag is None or tag.account_id != account_id:
        raise ValueError("TAG_NOT_FOUND")
    exists = (
        await db.execute(
            select(ContactTag).where(ContactTag.contact_id == contact_id, ContactTag.tag_id == tag_id)
        )
    ).scalar_one_or_none()
    if exists is None:
        db.add(ContactTag(contact_id=contact_id, tag_id=tag_id))
        await db.commit()


async def remove_contact_tag(db: AsyncSession, *, account_id: UUID, contact_id: UUID, tag_id: UUID) -> None:
    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")
    await db.execute(delete(ContactTag).where(ContactTag.contact_id == contact_id, ContactTag.tag_id == tag_id))
    await db.commit()


async def list_contact_tags(db: AsyncSession, account_id: UUID, contact_id: UUID) -> list[Tag]:
    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")
    result = await db.execute(
        select(Tag)
        .join(ContactTag, ContactTag.tag_id == Tag.id)
        .where(ContactTag.contact_id == contact_id)
        .order_by(Tag.name.asc())
    )
    return list(result.scalars().all())


async def create_custom_field(
    db: AsyncSession, *, account_id: UUID, entity_type: str, field_key: str, label: str, field_type: str = "text"
) -> CustomFieldDefinition:
    item = CustomFieldDefinition(
        account_id=account_id,
        entity_type=entity_type,
        field_key=field_key,
        label=label,
        field_type=field_type,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def list_custom_fields(db: AsyncSession, account_id: UUID, entity_type: str) -> list[CustomFieldDefinition]:
    result = await db.execute(
        select(CustomFieldDefinition)
        .where(CustomFieldDefinition.account_id == account_id, CustomFieldDefinition.entity_type == entity_type)
        .order_by(CustomFieldDefinition.label.asc())
    )
    return list(result.scalars().all())


async def set_custom_field_value(
    db: AsyncSession, *, definition_id: UUID, entity_id: UUID, value_text: str
) -> CustomFieldValue:
    existing = (
        await db.execute(
            select(CustomFieldValue).where(
                CustomFieldValue.definition_id == definition_id,
                CustomFieldValue.entity_id == entity_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.value_text = value_text
        item = existing
    else:
        item = CustomFieldValue(definition_id=definition_id, entity_id=entity_id, value_text=value_text)
        db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def get_custom_field_values(db: AsyncSession, entity_id: UUID) -> list[CustomFieldValue]:
    result = await db.execute(select(CustomFieldValue).where(CustomFieldValue.entity_id == entity_id))
    return list(result.scalars().all())


async def create_segment(db: AsyncSession, *, account_id: UUID, name: str, filter_json: dict) -> Segment:
    item = Segment(account_id=account_id, name=name, filter_json=filter_json)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def list_segments(db: AsyncSession, account_id: UUID) -> list[Segment]:
    result = await db.execute(select(Segment).where(Segment.account_id == account_id).order_by(Segment.name.asc()))
    return list(result.scalars().all())


async def count_segment_contacts(db: AsyncSession, *, account_id: UUID, segment: Segment) -> int:
    contacts = await resolve_segment_contacts(db, account_id=account_id, segment=segment)
    return len(contacts)


def _apply_segment_filters(query, filters: dict):
    if org_id := filters.get("organization_id"):
        query = query.where(Contact.organization_id == UUID(str(org_id)))
    if channel_id := filters.get("channel_id"):
        query = query.where(Contact.channel_id == UUID(str(channel_id)))
    if country := filters.get("country_code"):
        query = query.where(Contact.country_code == country)
    if search := filters.get("search"):
        term = f"%{search}%"
        query = query.where(
            or_(Contact.display_name.ilike(term), Contact.external_address.ilike(term), Contact.email.ilike(term))
        )
    if tag_ids := filters.get("tag_ids"):
        query = query.join(ContactTag, ContactTag.contact_id == Contact.id).where(
            ContactTag.tag_id.in_([UUID(str(i)) for i in tag_ids])
        )
    if tag_id := filters.get("tag_id"):
        query = query.join(ContactTag, ContactTag.contact_id == Contact.id).where(
            ContactTag.tag_id == UUID(str(tag_id))
        )
    if lifecycle_stage := filters.get("lifecycle_stage"):
        query = query.where(Contact.lifecycle_stage == str(lifecycle_stage))
    if filters.get("marketing_opt_in") is True:
        query = query.where(Contact.marketing_opt_in.is_(True))
    if reachability := filters.get("reachability_status"):
        query = query.where(Contact.reachability_status == str(reachability))
    if filters.get("exclude_unreachable") is True:
        query = query.where(
            (Contact.reachability_status.is_(None))
            | (Contact.reachability_status != ReachabilityStatus.UNREACHABLE)
        )
    if gender := filters.get("gender"):
        query = query.where(Contact.gender == str(gender))
    if exclude_genders := filters.get("exclude_genders"):
        values = [str(item) for item in exclude_genders if str(item) in {"male", "female", "unknown"}]
        if values:
            query = query.where(Contact.gender.notin_(values))
    if interest_ids := filters.get("interest_ids"):
        ids = [UUID(str(item)) for item in interest_ids]
        if ids:
            query = query.join(ContactInterest, ContactInterest.contact_id == Contact.id).where(
                ContactInterest.interest_id.in_(ids)
            )
    return query


async def resolve_audience_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    filters: dict,
    limit: int = 5000,
) -> list[Contact]:
    query = select(Contact).where(Contact.account_id == account_id, Contact.deleted_at.is_(None))
    query = _apply_segment_filters(query, filters)
    result = await db.execute(query.distinct().order_by(Contact.created_at.desc()).limit(min(max(limit, 1), 5000)))
    return list(result.scalars().all())


async def resolve_segment_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    segment: Segment,
    channel_id: UUID | None = None,
) -> list[Contact]:
    filters = dict(segment.filter_json or {})
    if channel_id is not None:
        filters["channel_id"] = str(channel_id)
    query = select(Contact).where(Contact.account_id == account_id, Contact.deleted_at.is_(None))
    query = _apply_segment_filters(query, filters)
    result = await db.execute(query.distinct().limit(5000))
    return list(result.scalars().all())


async def _build_contact_export_rows(
    db: AsyncSession,
    account_id: UUID,
    *,
    contact_ids: list[UUID] | None = None,
) -> list[list[str]]:
    query = (
        select(Contact, Organization.name, Channel.name)
        .join(Organization, Organization.id == Contact.organization_id)
        .join(Channel, Channel.id == Contact.channel_id)
        .where(Contact.account_id == account_id, Contact.deleted_at.is_(None))
        .order_by(Contact.created_at.desc())
    )
    if contact_ids:
        query = query.where(Contact.id.in_(contact_ids))

    rows = (await db.execute(query)).all()
    if not rows:
        return []

    ids = [contact.id for contact, _, _ in rows]
    tag_result = await db.execute(
        select(ContactTag.contact_id, Tag.name)
        .join(Tag, Tag.id == ContactTag.tag_id)
        .where(ContactTag.contact_id.in_(ids))
        .order_by(Tag.name.asc())
    )
    tag_map: dict[UUID, list[str]] = {}
    for contact_id, tag_name in tag_result.all():
        tag_map.setdefault(contact_id, []).append(tag_name)

    export_rows: list[list[str]] = []
    for contact, org_name, channel_name in rows:
        created_at = contact.created_at.isoformat() if contact.created_at else ""
        export_rows.append([
            contact.external_address,
            contact.display_name or "",
            contact.email or "",
            contact.language or "",
            contact.country_code or "",
            contact.gender or "unknown",
            gender_salutation(contact.gender),
            org_name,
            channel_name,
            ", ".join(tag_map.get(contact.id, [])),
            created_at,
        ])
    return export_rows


async def export_contacts_csv(
    db: AsyncSession,
    account_id: UUID,
    *,
    contact_ids: list[UUID] | None = None,
) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CONTACT_EXPORT_HEADERS)
    for row in await _build_contact_export_rows(db, account_id, contact_ids=contact_ids):
        writer.writerow(row)
    return buffer.getvalue()


async def export_contacts_xlsx(
    db: AsyncSession,
    account_id: UUID,
    *,
    contact_ids: list[UUID] | None = None,
) -> bytes:
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "العملاء"
    sheet.append(CONTACT_EXPORT_HEADERS)
    for row in await _build_contact_export_rows(db, account_id, contact_ids=contact_ids):
        sheet.append(row)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def apply_auto_tags_from_inbound(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    text_body: str | None,
) -> list[UUID]:
    """Add contact tags when inbound message text matches tag names or intent keywords."""
    if not text_body or not text_body.strip():
        return []

    from app.services.ai_assistant import detect_emotion, detect_intent

    tag_result = await db.execute(
        select(Tag).where(Tag.account_id == account_id).order_by(Tag.name.asc())
    )
    tags = list(tag_result.scalars().all())
    if not tags:
        return []

    text_lower = text_body.lower()
    matched_tag_ids: set[UUID] = set()

    for tag in tags:
        name_lower = tag.name.lower().strip()
        if len(name_lower) >= 2 and name_lower in text_lower:
            matched_tag_ids.add(tag.id)

    intent = detect_intent(text_body)
    emotion = detect_emotion(text_body)
    candidates: list[str] = []
    if intent["intent"] != "general":
        candidates.extend(INTENT_TAG_CANDIDATES.get(intent["intent"], []))
    if emotion["emotion"] == "frustrated":
        candidates.extend(INTENT_TAG_CANDIDATES.get("frustrated", []))
        candidates.extend(INTENT_TAG_CANDIDATES.get("complaint", []))
    elif emotion["emotion"] == "positive":
        candidates.extend(INTENT_TAG_CANDIDATES.get("positive", []))

    text_keywords = [
        ("purchase", INTENT_TAG_CANDIDATES["purchase"]),
        ("complaint", INTENT_TAG_CANDIDATES["complaint"]),
        ("quote", INTENT_TAG_CANDIDATES["quote"]),
    ]
    for _key, words in text_keywords:
        for word in words:
            if len(word) >= 2 and word.lower() in text_lower:
                candidates.extend(words)
                break

    tag_by_name = {tag.name.lower(): tag.id for tag in tags}
    for candidate in candidates:
        tag_id = tag_by_name.get(candidate.lower())
        if tag_id:
            matched_tag_ids.add(tag_id)

    if not matched_tag_ids:
        return []

    existing = await db.execute(
        select(ContactTag.tag_id).where(
            ContactTag.contact_id == contact_id,
            ContactTag.tag_id.in_(matched_tag_ids),
        )
    )
    existing_ids = set(existing.scalars().all())
    added: list[UUID] = []
    for tag_id in matched_tag_ids:
        if tag_id in existing_ids:
            continue
        db.add(ContactTag(contact_id=contact_id, tag_id=tag_id))
        added.append(tag_id)

    if added:
        await db.flush()
    return added


    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def export_contacts_template_xlsx() -> bytes:
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "قالب الاستيراد"
    sheet.append(CONTACT_IMPORT_TEMPLATE_HEADERS)
    sheet.append(["96512345678", "محمد أحمد", "user@example.com", "ar", "KW"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def get_contacts_stats(db: AsyncSession, account_id: UUID) -> dict:
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    inactive_cutoff = now - timedelta(days=30)

    base = Contact.account_id == account_id, Contact.deleted_at.is_(None)
    total = (await db.execute(select(func.count()).select_from(Contact).where(*base))).scalar_one()
    new_this_week = (
        await db.execute(select(func.count()).select_from(Contact).where(*base, Contact.created_at >= week_ago))
    ).scalar_one()
    without_name = (
        await db.execute(
            select(func.count()).select_from(Contact).where(
                *base,
                or_(Contact.display_name.is_(None), Contact.display_name == ""),
            )
        )
    ).scalar_one()

    inactive_30d = (
        await db.execute(
            select(func.count())
            .select_from(Contact)
            .where(
                *base,
                ~exists(
                    select(Message.id).where(
                        Message.contact_id == Contact.id,
                        Message.account_id == account_id,
                        Message.created_at >= inactive_cutoff,
                    ).limit(1)
                ),
            )
        )
    ).scalar_one()

    return {
        "total": total,
        "new_this_week": new_this_week,
        "without_name": without_name,
        "inactive_30d": inactive_30d,
    }


async def find_duplicate_phones(db: AsyncSession, account_id: UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(Contact.external_address, func.array_agg(Contact.id))
            .where(Contact.account_id == account_id, Contact.deleted_at.is_(None))
            .group_by(Contact.external_address)
            .having(func.count(Contact.id) > 1)
            .order_by(func.count(Contact.id).desc())
            .limit(200)
        )
    ).all()
    return [
        {"phone": phone, "contact_ids": list(ids), "count": len(ids)}
        for phone, ids in rows
    ]


async def get_duplicate_phone_set(db: AsyncSession, account_id: UUID) -> set[str]:
    groups = await find_duplicate_phones(db, account_id)
    return {group["phone"] for group in groups}


async def get_contact_activity(db: AsyncSession, *, account_id: UUID, contact_id: UUID) -> dict:
    contact = await get_contact_or_raise(db, account_id=account_id, contact_id=contact_id)

    last_msg = (
        await db.execute(
            select(Message)
            .where(Message.contact_id == contact_id, Message.account_id == account_id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    conv_rows = (
        await db.execute(
            select(Conversation)
            .where(Conversation.contact_id == contact_id, Conversation.account_id == account_id, Conversation.deleted_at.is_(None))
            .order_by(Conversation.last_message_at.desc().nullslast(), Conversation.created_at.desc())
        )
    ).scalars().all()

    conversations = [
        {
            "id": str(conv.id),
            "status": conv.status.value if hasattr(conv.status, "value") else str(conv.status),
            "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
            "is_blocked": (conv.status == ConversationStatus.SPAM),
        }
        for conv in conv_rows
    ]

    conv_ids = [conv.id for conv in conv_rows]
    notes: list[dict] = []
    if conv_ids:
        note_rows = (
            await db.execute(
                select(ConversationNote)
                .where(ConversationNote.conversation_id.in_(conv_ids))
                .order_by(ConversationNote.created_at.desc())
                .limit(20)
            )
        ).scalars().all()
        notes = [
            {
                "id": str(note.id),
                "conversation_id": str(note.conversation_id),
                "body": note.body,
                "created_at": note.created_at.isoformat() if note.created_at else None,
            }
            for note in note_rows
        ]

    open_conv = next(
        (c for c in conv_rows if c.status in (ConversationStatus.OPEN, ConversationStatus.PENDING)),
        conv_rows[0] if conv_rows else None,
    )

    return {
        "last_message_text": last_msg.text_body if last_msg else None,
        "last_message_at": last_msg.created_at.isoformat() if last_msg and last_msg.created_at else None,
        "last_message_direction": last_msg.direction.value if last_msg and hasattr(last_msg.direction, "value") else (str(last_msg.direction) if last_msg else None),
        "conversations": conversations,
        "notes": notes,
        "primary_conversation_id": str(open_conv.id) if open_conv else None,
        "is_blocked": any(c["is_blocked"] for c in conversations),
    }


async def get_or_create_conversation_for_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
) -> tuple[Conversation, bool]:
    contact = await get_contact_or_raise(db, account_id=account_id, contact_id=contact_id)

    conv_result = await db.execute(
        select(Conversation).where(
            Conversation.contact_id == contact.id,
            Conversation.channel_id == contact.channel_id,
            Conversation.deleted_at.is_(None),
            Conversation.status.in_([ConversationStatus.OPEN, ConversationStatus.PENDING]),
        )
    )
    conversation = conv_result.scalars().first()
    if conversation is not None:
        return conversation, False

    conversation = Conversation(
        account_id=account_id,
        organization_id=contact.organization_id,
        channel_id=contact.channel_id,
        contact_id=contact.id,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation, True


async def start_conversation_on_channel(
    db: AsyncSession,
    *,
    account_id: UUID,
    channel_id: UUID,
    external_address: str,
    display_name: str | None = None,
) -> tuple[Conversation, Contact, bool]:
    from app.services.contacts import create_contact

    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("INVALID_CHANNEL")

    phone = normalize_whatsapp_phone(external_address.strip())
    if len(phone) < 3:
        raise ValueError("INVALID_PHONE")

    contact = await create_contact(
        db,
        account_id=account_id,
        payload=ContactCreateRequest(
            organization_id=channel.organization_id,
            channel_id=channel.id,
            external_address=phone,
            display_name=display_name,
        ),
    )
    conversation, created = await get_or_create_conversation_for_contact(
        db,
        account_id=account_id,
        contact_id=contact.id,
    )
    return conversation, contact, created


async def list_channel_threads_for_phone(
    db: AsyncSession,
    *,
    account_id: UUID,
    external_address: str,
    exclude_conversation_id: UUID | None = None,
) -> list[dict]:
    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.phone_normalize import normalize_whatsapp_phone, phones_match

    target = normalize_whatsapp_phone(external_address.strip())
    if not target:
        return []

    contact_rows = await db.execute(
        select(Contact, Channel.name, WhatsAppAccount.display_phone_number)
        .join(Channel, Contact.channel_id == Channel.id)
        .outerjoin(WhatsAppAccount, WhatsAppAccount.channel_id == Channel.id)
        .where(
            Contact.account_id == account_id,
            Contact.deleted_at.is_(None),
            Channel.deleted_at.is_(None),
        )
        .order_by(Channel.name.asc())
    )

    threads: list[dict] = []
    for contact, channel_name, display_phone in contact_rows.all():
        if not phones_match(contact.external_address, target):
            continue
        conv_result = await db.execute(
            select(Conversation)
            .where(
                Conversation.contact_id == contact.id,
                Conversation.channel_id == contact.channel_id,
                Conversation.deleted_at.is_(None),
                Conversation.status.in_([ConversationStatus.OPEN, ConversationStatus.PENDING]),
            )
            .order_by(Conversation.last_message_at.desc().nullslast(), Conversation.created_at.desc())
            .limit(1)
        )
        conversation = conv_result.scalars().first()
        if conversation is None:
            continue
        if exclude_conversation_id is not None and conversation.id == exclude_conversation_id:
            continue
        threads.append(
            {
                "conversation_id": str(conversation.id),
                "contact_id": str(contact.id),
                "channel_id": str(contact.channel_id),
                "channel_name": channel_name,
                "display_phone_number": display_phone,
                "status": conversation.status.value if hasattr(conversation.status, "value") else str(conversation.status),
            }
        )
    return threads


async def export_contact_gdpr_json(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
) -> dict:
    contact = await get_contact_or_raise(db, account_id=account_id, contact_id=contact_id)
    tags = await list_contact_tags(db, account_id, contact_id)
    custom_fields = await get_custom_field_values(db, contact_id)
    activity = await get_contact_activity(db, account_id=account_id, contact_id=contact_id)

    field_defs = (
        await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.account_id == account_id))
    ).scalars().all()
    def_map = {d.id: d for d in field_defs}

    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "contact": {
            "id": str(contact.id),
            "display_name": contact.display_name,
            "external_address": contact.external_address,
            "email": contact.email,
            "language": contact.language,
            "country_code": contact.country_code,
            "gender": contact.gender,
            "marketing_opt_in": contact.marketing_opt_in,
            "created_at": contact.created_at.isoformat() if contact.created_at else None,
            "updated_at": contact.updated_at.isoformat() if contact.updated_at else None,
        },
        "tags": [{"id": str(t.id), "name": t.name} for t in tags],
        "custom_fields": [
            {
                "field_key": def_map[v.definition_id].field_key if v.definition_id in def_map else str(v.definition_id),
                "label": def_map[v.definition_id].label if v.definition_id in def_map else "",
                "value": v.value_text,
            }
            for v in custom_fields
        ],
        "activity": activity,
    }


async def import_contacts_from_rows(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    channel_id: UUID,
    rows: list[dict[str, str]],
) -> dict:
    from app.services.gender_inference import infer_gender_from_name
    from app.services.phone_normalize import normalize_whatsapp_phone
    from app.services.spreadsheet import get_row_value

    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != account_id or channel.deleted_at is not None:
        raise ValueError("INVALID_CHANNEL")
    if channel.organization_id != organization_id:
        raise ValueError("CHANNEL_ORGANIZATION_MISMATCH")

    existing_rows = (
        await db.execute(
            select(Contact.id, Contact.external_address).where(
                Contact.organization_id == organization_id,
                Contact.channel_id == channel_id,
                Contact.deleted_at.is_(None),
            )
        )
    ).all()
    existing_by_phone = {row.external_address: row.id for row in existing_rows}

    created = skipped = existing = invalid = 0
    contact_ids: list[str] = []
    batch_count = 0

    for row in rows:
        raw_phone = get_row_value(row, "phone")
        if not raw_phone:
            skipped += 1
            continue

        country_raw = get_row_value(row, "country_code") or "KW"
        dial = {"KW": "965", "SA": "966", "AE": "971", "QA": "974", "BH": "973", "OM": "968"}.get(
            country_raw.upper(), "965"
        )
        phone = normalize_whatsapp_phone(raw_phone, country_code=dial)
        if not phone:
            invalid += 1
            continue

        name = get_row_value(row, "name") or None
        email_raw = get_row_value(row, "email")
        email = email_raw if email_raw and "@" in email_raw and "." in email_raw.split("@")[-1] else None
        language = get_row_value(row, "language") or "ar"
        country_code = country_raw.upper()[:2] if len(country_raw.strip()) >= 2 else "KW"
        gender = infer_gender_from_name(name)
        already_id = existing_by_phone.get(phone)

        if already_id:
            contact = await db.get(Contact, already_id)
            if contact is not None:
                if name:
                    contact.display_name = name
                    contact.gender = gender
                if email is not None:
                    contact.email = email
                if language:
                    contact.language = language
                contact.country_code = country_code
                contact.updated_at = datetime.now(UTC)
            existing += 1
            if contact is not None:
                contact_ids.append(str(contact.id))
        else:
            contact = Contact(
                account_id=account_id,
                organization_id=organization_id,
                channel_id=channel_id,
                external_address=phone,
                display_name=name,
                email=email,
                language=language,
                country_code=country_code,
                gender=gender,
            )
            db.add(contact)
            await db.flush()
            existing_by_phone[phone] = contact.id
            contact_ids.append(str(contact.id))
            created += 1

        batch_count += 1
        if batch_count >= 100:
            await db.commit()
            batch_count = 0

    if batch_count:
        await db.commit()

    return {
        "created": created,
        "existing": existing,
        "skipped": skipped,
        "invalid": invalid,
        "total": len(contact_ids),
        "contact_ids": contact_ids,
    }


async def import_contacts_csv(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    channel_id: UUID,
    csv_text: str,
) -> dict:
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = [
        {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
        for row in reader
    ]
    return await import_contacts_from_rows(
        db,
        account_id=account_id,
        organization_id=organization_id,
        channel_id=channel_id,
        rows=rows,
    )


async def import_contacts_file(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    channel_id: UUID,
    content: bytes,
    filename: str,
) -> dict:
    from app.services.spreadsheet import parse_spreadsheet

    rows = parse_spreadsheet(content, filename)
    return await import_contacts_from_rows(
        db,
        account_id=account_id,
        organization_id=organization_id,
        channel_id=channel_id,
        rows=rows,
    )
