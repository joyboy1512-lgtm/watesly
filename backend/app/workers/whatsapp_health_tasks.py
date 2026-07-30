import asyncio

from sqlalchemy import select

from app.db.session import AsyncSessionFactory
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus
from app.services.whatsapp_health import sync_whatsapp_account_health_safe
from app.workers.celery_app import celery_app


async def _sync_all_whatsapp_health() -> dict:
    synced = 0
    disconnected = 0
    async with AsyncSessionFactory() as db:
        result = await db.execute(
            select(WhatsAppAccount).where(
                WhatsAppAccount.status.in_(
                    [WhatsAppAccountStatus.ACTIVE, WhatsAppAccountStatus.PENDING]
                )
            )
        )
        accounts = list(result.scalars().all())
        for account in accounts:
            before = account.status
            updated = await sync_whatsapp_account_health_safe(db, whatsapp_account=account)
            synced += 1
            if updated.status == WhatsAppAccountStatus.DISCONNECTED and before != WhatsAppAccountStatus.DISCONNECTED:
                disconnected += 1
    return {"checked": synced, "newly_disconnected": disconnected}


@celery_app.task(name="watesly.whatsapp.sync_health", queue="default")
def sync_whatsapp_health() -> dict:
    return asyncio.run(_sync_all_whatsapp_health())
