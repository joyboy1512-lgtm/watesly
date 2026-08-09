"""Follow-up campaigns from parent campaign recipient statuses."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignStatus
from app.models.membership import Membership
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.services.feature_flags import get_feature_flags
from app.services.outbox import add_outbox_event

FOLLOW_UP_TYPES = {
    "not_delivered": {
        CampaignRecipientStatus.SENT,
        CampaignRecipientStatus.FAILED,
        CampaignRecipientStatus.PENDING,
        CampaignRecipientStatus.QUEUED,
    },
    "not_read": {
        CampaignRecipientStatus.SENT,
        CampaignRecipientStatus.DELIVERED,
        CampaignRecipientStatus.FAILED,
        CampaignRecipientStatus.PENDING,
        CampaignRecipientStatus.QUEUED,
    },
    "failed": {CampaignRecipientStatus.FAILED},
}


async def create_follow_up_campaign(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    campaign_id: UUID,
    follow_up_type: str,
    name_suffix: str | None = None,
    membership: Membership | None = None,
) -> Campaign:
    from app.services.campaigns import get_campaign

    flags = await get_feature_flags(db, account_id=account_id)
    if not flags.get("follow_up_campaigns"):
        raise ValueError("FOLLOW_UP_CAMPAIGNS_DISABLED")

    if follow_up_type not in FOLLOW_UP_TYPES:
        raise ValueError("INVALID_FOLLOW_UP_TYPE")

    parent = await get_campaign(
        db, account_id=account_id, campaign_id=campaign_id, membership=membership
    )
    if parent.status not in {
        CampaignStatus.COMPLETED,
        CampaignStatus.COMPLETED_WITH_ERRORS,
        CampaignStatus.PAUSED,
    }:
        raise ValueError("PARENT_CAMPAIGN_NOT_FINISHED")

    target_statuses = FOLLOW_UP_TYPES[follow_up_type]
    rows = (
        await db.execute(
            select(CampaignRecipient, Contact)
            .join(Contact, Contact.id == CampaignRecipient.contact_id)
            .where(
                CampaignRecipient.campaign_id == parent.id,
                CampaignRecipient.status.in_(target_statuses),
                Contact.deleted_at.is_(None),
            )
        )
    ).all()
    if not rows:
        raise ValueError("NO_FOLLOW_UP_RECIPIENTS")

    suffix = name_suffix or {
        "not_delivered": "متابعة — لم يُسلّم",
        "not_read": "متابعة — لم يُقرأ",
        "failed": "متابعة — فشل",
    }.get(follow_up_type, "متابعة")
    child_name = f"{parent.name} — {suffix}"[:160]

    child = Campaign(
        account_id=parent.account_id,
        organization_id=parent.organization_id,
        whatsapp_account_id=parent.whatsapp_account_id,
        template_id=parent.template_id,
        created_by_user_id=user_id,
        name=child_name,
        status=CampaignStatus.DRAFT,
        max_recipients=min(len(rows), parent.max_recipients),
        requires_approval=True,
        parent_campaign_id=parent.id,
        follow_up_type=follow_up_type,
    )
    db.add(child)
    await db.flush()

    for recipient, _contact in rows:
        db.add(
            CampaignRecipient(
                campaign_id=child.id,
                contact_id=recipient.contact_id,
                template_parameters=recipient.template_parameters,
            )
        )

    await add_outbox_event(
        db,
        account_id=account_id,
        event_type="campaign.follow_up_created",
        aggregate_type="campaign",
        aggregate_id=str(child.id),
        payload={
            "campaign_id": str(child.id),
            "parent_campaign_id": str(parent.id),
            "follow_up_type": follow_up_type,
            "recipient_count": len(rows),
        },
    )
    await db.commit()
    await db.refresh(child)
    return child
