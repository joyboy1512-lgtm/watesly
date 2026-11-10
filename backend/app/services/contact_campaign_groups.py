"""Contact campaign groups (tags) and last-campaign enrichment for the contacts list."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.tag import Tag

_SENT_STATUSES = (
    CampaignRecipientStatus.SENT,
    CampaignRecipientStatus.DELIVERED,
    CampaignRecipientStatus.READ,
)

CAMPAIGN_GROUP_PREFIX = "حملة:"


def campaign_group_tag_name(campaign_name: str) -> str:
    clean = " ".join((campaign_name or "").strip().split())
    if not clean:
        clean = "بدون اسم"
    name = f"{CAMPAIGN_GROUP_PREFIX} {clean}"
    return name[:80]


async def get_or_create_tag(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    name: str,
    color: str | None = "#175cd3",
) -> Tag:
    existing = await db.execute(
        select(Tag).where(
            Tag.account_id == account_id,
            Tag.organization_id == organization_id,
            Tag.name == name,
        )
    )
    tag = existing.scalar_one_or_none()
    if tag is not None:
        return tag
    tag = Tag(
        account_id=account_id,
        organization_id=organization_id,
        name=name[:80],
        color=color,
    )
    db.add(tag)
    await db.flush()
    return tag


async def apply_tag_to_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    tag_id: UUID,
    contact_ids: list[UUID],
) -> int:
    if not contact_ids:
        return 0
    valid = (
        await db.execute(
            select(Contact.id).where(
                Contact.account_id == account_id,
                Contact.deleted_at.is_(None),
                Contact.id.in_(contact_ids),
            )
        )
    ).scalars().all()
    if not valid:
        return 0
    existing = (
        await db.execute(
            select(ContactTag.contact_id).where(
                ContactTag.tag_id == tag_id,
                ContactTag.contact_id.in_(list(valid)),
            )
        )
    ).scalars().all()
    already = set(existing)
    added = 0
    for contact_id in valid:
        if contact_id in already:
            continue
        db.add(ContactTag(contact_id=contact_id, tag_id=tag_id))
        added += 1
    if added:
        await db.flush()
    return added


async def tag_campaign_sent_recipients_as_group(
    db: AsyncSession,
    *,
    campaign: Campaign,
) -> dict:
    """Create/reuse a campaign group tag and attach it to successfully messaged recipients."""
    result = await db.execute(
        select(CampaignRecipient.contact_id).where(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.status.in_(_SENT_STATUSES),
        )
    )
    contact_ids = list({row for row in result.scalars().all()})
    if not contact_ids:
        return {"tag_id": None, "tagged": 0, "tag_name": None}

    tag_name = campaign_group_tag_name(campaign.name)
    tag = await get_or_create_tag(
        db,
        account_id=campaign.account_id,
        organization_id=campaign.organization_id,
        name=tag_name,
    )
    tagged = await apply_tag_to_contacts(
        db,
        account_id=campaign.account_id,
        tag_id=tag.id,
        contact_ids=contact_ids,
    )
    return {"tag_id": str(tag.id), "tagged": tagged, "tag_name": tag.name}


async def create_contact_group(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    name: str,
    contact_ids: list[UUID],
    color: str | None = None,
) -> dict:
    if not contact_ids:
        raise ValueError("NO_CONTACTS")
    clean = " ".join((name or "").strip().split())
    if len(clean) < 1:
        raise ValueError("INVALID_NAME")
    tag = await get_or_create_tag(
        db,
        account_id=account_id,
        organization_id=organization_id,
        name=clean[:80],
        color=color or "#5925dc",
    )
    tagged = await apply_tag_to_contacts(
        db,
        account_id=account_id,
        tag_id=tag.id,
        contact_ids=contact_ids,
    )
    await db.commit()
    await db.refresh(tag)
    return {
        "id": str(tag.id),
        "name": tag.name,
        "organization_id": str(tag.organization_id),
        "color": tag.color,
        "tagged": tagged,
        "requested": len(contact_ids),
    }


async def load_last_campaigns_for_contacts(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_ids: list[UUID],
) -> dict[UUID, dict]:
    """Return contact_id -> {last_campaign_id, last_campaign_name, last_campaign_at}."""
    if not contact_ids:
        return {}

    event_at = func.coalesce(
        CampaignRecipient.sending_started_at,
        Campaign.started_at,
        Campaign.completed_at,
        CampaignRecipient.updated_at,
        CampaignRecipient.created_at,
    )
    ranked = (
        select(
            CampaignRecipient.contact_id.label("contact_id"),
            Campaign.id.label("campaign_id"),
            Campaign.name.label("campaign_name"),
            event_at.label("event_at"),
            func.row_number()
            .over(
                partition_by=CampaignRecipient.contact_id,
                order_by=event_at.desc(),
            )
            .label("rn"),
        )
        .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
        .where(
            Campaign.account_id == account_id,
            CampaignRecipient.contact_id.in_(contact_ids),
            CampaignRecipient.status.in_(_SENT_STATUSES),
        )
    ).subquery()

    rows = await db.execute(
        select(
            ranked.c.contact_id,
            ranked.c.campaign_id,
            ranked.c.campaign_name,
            ranked.c.event_at,
        ).where(ranked.c.rn == 1)
    )
    out: dict[UUID, dict] = {}
    for contact_id, campaign_id, campaign_name, event_at_value in rows.all():
        at: datetime | None = event_at_value
        out[contact_id] = {
            "last_campaign_id": campaign_id,
            "last_campaign_name": campaign_name,
            "last_campaign_at": at,
        }
    return out
