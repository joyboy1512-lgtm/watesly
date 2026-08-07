"""Restart stuck scheduled campaigns on production."""
import asyncio
from sqlalchemy import select

from app.db.session import AsyncSessionFactory
from app.models.campaign import Campaign, CampaignStatus
from app.services.campaigns import prepare_campaign_start
from app.workers.campaign_tasks import run_campaign


async def main() -> None:
    async with AsyncSessionFactory() as db:
        rows = (
            await db.execute(
                select(Campaign).where(Campaign.status == CampaignStatus.SCHEDULED).order_by(Campaign.created_at.desc())
            )
        ).scalars().all()
        if not rows:
            print("NO_SCHEDULED")
            return
        for campaign in rows:
            print("RESTART", campaign.id, campaign.name)
            campaign = await prepare_campaign_start(db, account_id=campaign.account_id, campaign_id=campaign.id)
            task = run_campaign.apply_async(
                args=[str(campaign.id), str(campaign.execution_token)],
                queue="campaigns",
            )
            campaign.active_task_id = task.id
            await db.commit()
            print("QUEUED", task.id)


if __name__ == "__main__":
    asyncio.run(main())
