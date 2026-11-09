"""Recover stuck campaigns and retry failed recipients."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import func, select, update

from app.db.session import AsyncSessionFactory
from app.models.campaign import Campaign, CampaignStatus
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.workers.campaign_tasks import run_campaign

STALE_RUNNING_MINUTES = 15
STALE_SCHEDULED_MINUTES = 3


async def recover_stuck_campaigns(*, limit: int = 20) -> dict:
    now = datetime.now(UTC)
    running_cutoff = now - timedelta(minutes=STALE_RUNNING_MINUTES)
    scheduled_cutoff = now - timedelta(minutes=STALE_SCHEDULED_MINUTES)
    recovered = 0
    async with AsyncSessionFactory() as db:
        running_rows = (
            await db.execute(
                select(Campaign)
                .where(
                    Campaign.status == CampaignStatus.RUNNING,
                    Campaign.last_heartbeat_at.is_not(None),
                    Campaign.last_heartbeat_at < running_cutoff,
                )
                .order_by(Campaign.last_heartbeat_at.asc())
                .limit(limit)
            )
        ).scalars().all()
        scheduled_rows = (
            await db.execute(
                select(Campaign)
                .where(
                    Campaign.status == CampaignStatus.SCHEDULED,
                    Campaign.started_at.is_(None),
                    Campaign.created_at < scheduled_cutoff,
                )
                .order_by(Campaign.created_at.asc())
                .limit(limit)
            )
        ).scalars().all()
        rows = list(running_rows) + [item for item in scheduled_rows if item not in running_rows]
        for campaign in rows[:limit]:
            campaign.execution_token = uuid4()
            campaign.status = CampaignStatus.SCHEDULED
            campaign.active_task_id = None
            await db.commit()
            task = run_campaign.apply_async(
                args=[str(campaign.id), str(campaign.execution_token)],
                queue="campaigns",
            )
            campaign.active_task_id = task.id
            campaign.status = CampaignStatus.RUNNING
            campaign.last_heartbeat_at = datetime.now(UTC)
            await db.commit()
            recovered += 1
    return {"recovered": recovered}


async def list_campaign_failed_reasons(
    db,
    *,
    account_id: UUID,
    campaign_id: UUID,
    membership=None,
) -> dict:
    from app.services.campaign_failure_reasons import group_failed_recipients
    from app.services.campaigns import get_campaign

    campaign = await get_campaign(
        db, account_id=account_id, campaign_id=campaign_id, membership=membership
    )
    rows = (
        await db.execute(
            select(CampaignRecipient.id, CampaignRecipient.error_message).where(
                CampaignRecipient.campaign_id == campaign.id,
                CampaignRecipient.status == CampaignRecipientStatus.FAILED,
            )
        )
    ).all()
    groups = group_failed_recipients([(row[0], row[1]) for row in rows])
    return {
        "campaign_id": str(campaign.id),
        "failed_total": sum(item["count"] for item in groups),
        "reasons": groups,
    }


async def retry_failed_campaign_recipients(
    db,
    *,
    account_id: UUID,
    campaign_id: UUID,
    membership=None,
    reason_keys: list[str] | None = None,
) -> dict:
    from app.services.campaign_failure_reasons import (
        CampaignFailureReason,
        classify_campaign_failure,
    )
    from app.services.campaigns import get_campaign

    campaign = await get_campaign(
        db, account_id=account_id, campaign_id=campaign_id, membership=membership
    )
    if campaign.status not in {
        CampaignStatus.COMPLETED,
        CampaignStatus.COMPLETED_WITH_ERRORS,
        CampaignStatus.PAUSED,
        CampaignStatus.FAILED,
    }:
        raise ValueError("CAMPAIGN_CANNOT_RETRY")

    selected_reasons: set[str] | None = None
    if reason_keys:
        valid = {item.value for item in CampaignFailureReason}
        selected_reasons = {key for key in reason_keys if key in valid}
        if not selected_reasons:
            raise ValueError("INVALID_FAILURE_REASON")

    failed_rows = (
        await db.execute(
            select(CampaignRecipient).where(
                CampaignRecipient.campaign_id == campaign.id,
                CampaignRecipient.status == CampaignRecipientStatus.FAILED,
            )
        )
    ).scalars().all()

    recipient_ids: list[UUID] = []
    for recipient in failed_rows:
        reason = classify_campaign_failure(recipient.error_message).value
        if selected_reasons is None or reason in selected_reasons:
            recipient_ids.append(recipient.id)

    if not recipient_ids:
        raise ValueError("NO_FAILED_RECIPIENTS")

    result = await db.execute(
        update(CampaignRecipient)
        .where(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.id.in_(recipient_ids),
            CampaignRecipient.status == CampaignRecipientStatus.FAILED,
        )
        .values(
            status=CampaignRecipientStatus.PENDING,
            error_message=None,
            external_message_id=None,
            sending_started_at=None,
        )
        .returning(CampaignRecipient.id)
    )
    reset_count = len(result.scalars().all())
    if reset_count == 0:
        raise ValueError("NO_FAILED_RECIPIENTS")

    campaign.status = CampaignStatus.SCHEDULED
    campaign.execution_token = uuid4()
    campaign.active_task_id = None
    campaign.completed_at = None
    campaign.last_heartbeat_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(campaign)

    task = run_campaign.apply_async(
        args=[str(campaign.id), str(campaign.execution_token)],
        queue="campaigns",
    )
    campaign.active_task_id = task.id
    campaign.status = CampaignStatus.RUNNING
    await db.commit()
    await db.refresh(campaign)
    return {
        "reset": reset_count,
        "campaign_id": str(campaign.id),
        "task_id": task.id,
        "reason_keys": sorted(selected_reasons) if selected_reasons else ["all"],
    }


async def count_sendable_recipients(db, *, campaign_id: UUID) -> int:
    return int(
        (
            await db.scalar(
                select(func.count(CampaignRecipient.id)).where(
                    CampaignRecipient.campaign_id == campaign_id,
                    CampaignRecipient.status.in_(
                        [
                            CampaignRecipientStatus.PENDING,
                            CampaignRecipientStatus.QUEUED,
                        ]
                    ),
                )
            )
        )
        or 0
    )
