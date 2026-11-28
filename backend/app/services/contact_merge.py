from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.models.custom_field import CustomFieldValue


def _digits_only(value: str | None) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _looks_like_phone(value: str | None) -> bool:
    digits = _digits_only(value)
    return 8 <= len(digits) <= 15


async def suggest_contact_merges_for_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
) -> list[dict]:
    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id or contact.deleted_at is not None:
        raise ValueError("CONTACT_NOT_FOUND")

    address = (contact.external_address or "").strip()
    email = (contact.email or "").strip().lower() or None
    phone_digits = _digits_only(address) if _looks_like_phone(address) else ""
    if not address and not email:
        return []

    query = (
        select(Contact, Channel.type)
        .outerjoin(Channel, Channel.id == Contact.channel_id)
        .where(
            Contact.account_id == account_id,
            Contact.deleted_at.is_(None),
            Contact.id != contact_id,
        )
    )
    rows = list((await db.execute(query)).all())
    suggestions: list[dict] = []
    for row, channel_type in rows:
        same_phone = bool(address) and row.external_address == address
        same_phone_normalized = False
        if phone_digits and _looks_like_phone(row.external_address):
            other_digits = _digits_only(row.external_address)
            same_phone_normalized = other_digits == phone_digits or (
                len(other_digits) >= 8
                and len(phone_digits) >= 8
                and (other_digits.endswith(phone_digits[-8:]) or phone_digits.endswith(other_digits[-8:]))
            )
        same_email = bool(email) and (row.email or "").strip().lower() == email
        same_org = row.organization_id == contact.organization_id
        if not same_phone and not same_phone_normalized and not same_email:
            continue
        # Prefer cross-channel / same-org matches for Wave 6 identity unify.
        if not same_org and not same_email:
            continue
        reasons = []
        if same_phone or same_phone_normalized:
            reasons.append("same_phone")
        if same_email:
            reasons.append("same_email")
        if channel_type and str(row.channel_id) != str(contact.channel_id):
            reasons.append("cross_channel")
        suggestions.append(
            {
                "contact_id": str(row.id),
                "display_name": row.display_name,
                "external_address": row.external_address,
                "email": row.email,
                "channel_id": str(row.channel_id),
                "channel_type": str(channel_type) if channel_type else None,
                "organization_id": str(row.organization_id),
                "reasons": reasons,
            }
        )
    return suggestions


async def merge_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    primary_contact_id: UUID,
    secondary_contact_id: UUID,
) -> dict:
    if primary_contact_id == secondary_contact_id:
        raise ValueError("SAME_CONTACT")

    primary = await db.get(Contact, primary_contact_id)
    secondary = await db.get(Contact, secondary_contact_id)
    if (
        primary is None
        or secondary is None
        or primary.account_id != account_id
        or secondary.account_id != account_id
        or primary.deleted_at is not None
        or secondary.deleted_at is not None
    ):
        raise ValueError("CONTACT_NOT_FOUND")

    if not primary.display_name and secondary.display_name:
        primary.display_name = secondary.display_name
    if not primary.email and secondary.email:
        primary.email = secondary.email
    if not primary.region and secondary.region:
        primary.region = secondary.region
    if not primary.gender or primary.gender == "unknown":
        if secondary.gender and secondary.gender != "unknown":
            primary.gender = secondary.gender

    moved = await db.execute(
        update(Conversation)
        .where(
            Conversation.contact_id == secondary_contact_id,
            Conversation.account_id == account_id,
            Conversation.deleted_at.is_(None),
        )
        .values(contact_id=primary_contact_id)
    )

    secondary_values = list(
        (
            await db.execute(
                select(CustomFieldValue).where(CustomFieldValue.entity_id == secondary_contact_id)
            )
        )
        .scalars()
        .all()
    )
    primary_defs = {
        row.definition_id
        for row in (
            await db.execute(
                select(CustomFieldValue).where(CustomFieldValue.entity_id == primary_contact_id)
            )
        )
        .scalars()
        .all()
    }
    for value in secondary_values:
        if value.definition_id in primary_defs:
            await db.delete(value)
        else:
            value.entity_id = primary_contact_id

    secondary.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {
        "primary_contact_id": str(primary_contact_id),
        "merged_contact_id": str(secondary_contact_id),
        "moved_conversations": int(moved.rowcount or 0),
    }
