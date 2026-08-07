import asyncio
from uuid import UUID

from app.db.session import AsyncSessionFactory
from app.workers.celery_app import celery_app


async def _send_lead(account_id: str, phone: str, campaign: str | None) -> dict:
    from app.services.meta_capi import send_capi_event

    async with AsyncSessionFactory() as db:
        return await send_capi_event(
            db,
            account_id=UUID(account_id),
            event_name="Lead",
            phone=phone,
            custom_data={"utm_campaign": campaign} if campaign else {},
        )


@celery_app.task(name="watesly.growth.meta_capi_lead", max_retries=1)
def send_meta_capi_lead(account_id: str, phone: str, utm_campaign: str | None = None) -> dict:
    return asyncio.run(_send_lead(account_id, phone, utm_campaign))
