"""Follow-up campaigns from parent campaign recipient statuses."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignStatus
from app.models.membership import Membership
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.services.campaign_send_guard import (
    is_safe_to_resend_failure,
    is_uncertain_delivery_failure,
    normalize_contact_phone,
    reconcile_uncertain_failed_recipient,
)
from app.services.feature_flags import get_feature_flags
from app.services.outbox import add_outbox_event

# Only statuses that mean the customer did NOT already get a confirmed send.
# never include SENT/DELIVERED/READ for "failed"/"not_delivered" — that caused duplicates.
FOLLOW_UP_TYPES = {
    "not_delivered": {CampaignRecipientStatus.FAILED},
    "not_read": {CampaignRecipientStatus.DELIVERED},
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
        CampaignStatus.FAILED,
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

    eligible: list[tuple[CampaignRecipient, Contact]] = []
    seen_phones: set[str] = set()
    reconciled = 0
    skipped_uncertain = 0
    skipped_duplicate_phone = 0
    skipped_unsafe = 0

    for recipient, contact in rows:
        if follow_up_type in {"failed", "not_delivered"}:
            if is_uncertain_delivery_failure(recipient.error_message):
                restored = await reconcile_uncertain_failed_recipient(
                    db, campaign_id=parent.id, recipient=recipient
                )
                if restored is not None:
                    reconciled += 1
                    continue
                skipped_uncertain += 1
                continue
            if not is_safe_to_resend_failure(recipient.error_message):
                skipped_unsafe += 1
                continue

        phone = normalize_contact_phone(contact.external_address, contact.country_code)
        if phone:
            if phone in seen_phones:
                skipped_duplicate_phone += 1
                continue
            seen_phones.add(phone)

        eligible.append((recipient, contact))

    if not eligible:
        await db.commit()
        raise ValueError("NO_FOLLOW_UP_RECIPIENTS")

    suffix = name_suffix or {
        "not_delivered": "متابعة — لم يُسلّم",
        "not_read": "متابعة — لم يُقرأ",
        "failed": "متابعة — فشل مؤكد",
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
        max_recipients=min(len(eligible), parent.max_recipients),
        requires_approval=True,
        parent_campaign_id=parent.id,
        follow_up_type=follow_up_type,
    )
    db.add(child)
    await db.flush()

    for recipient, _contact in eligible:
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
            "recipient_count": len(eligible),
            "reconciled_uncertain": reconciled,
            "skipped_uncertain": skipped_uncertain,
            "skipped_unsafe": skipped_unsafe,
            "skipped_duplicate_phone": skipped_duplicate_phone,
        },
    )
    await db.commit()
    await db.refresh(child)
    return child
