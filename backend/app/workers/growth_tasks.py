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


async def _send_purchase(
    account_id: str,
    phone: str | None,
    *,
    value: float | None,
    currency: str | None,
    content_name: str | None,
    deal_id: str | None,
) -> dict:
    from app.services.meta_capi import send_capi_event

    custom_data: dict = {}
    if value is not None:
        custom_data["value"] = value
    if currency:
        custom_data["currency"] = currency
    if content_name:
        custom_data["content_name"] = content_name
    if deal_id:
        custom_data["deal_id"] = deal_id

    async with AsyncSessionFactory() as db:
        return await send_capi_event(
            db,
            account_id=UUID(account_id),
            event_name="Purchase",
            phone=phone,
            custom_data=custom_data,
        )


@celery_app.task(name="watesly.growth.meta_capi_lead", max_retries=1)
def send_meta_capi_lead(account_id: str, phone: str, utm_campaign: str | None = None) -> dict:
    return asyncio.run(_send_lead(account_id, phone, utm_campaign))


@celery_app.task(name="watesly.growth.meta_capi_purchase", max_retries=1)
def send_meta_capi_purchase(
    account_id: str,
    phone: str | None = None,
    value: float | None = None,
    currency: str | None = None,
    content_name: str | None = None,
    deal_id: str | None = None,
) -> dict:
    return asyncio.run(
        _send_purchase(
            account_id,
            phone,
            value=value,
            currency=currency,
            content_name=content_name,
            deal_id=deal_id,
        )
    )
