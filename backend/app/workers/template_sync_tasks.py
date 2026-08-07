"""Periodic sync of WhatsApp template approval status from Meta."""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.core.encryption import decrypt_secret
from app.db.session import AsyncSessionFactory
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.services.templates import sync_templates_from_meta
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app


async def _sync_pending_templates() -> dict:
    synced_accounts = updated_templates = 0
    async with AsyncSessionFactory() as db:
        accounts = list((await db.execute(select(WhatsAppAccount))).scalars())
        for wa in accounts:
            pending = (
                await db.execute(
                    select(WhatsAppTemplate.id).where(
                        WhatsAppTemplate.whatsapp_account_id == wa.id,
                        WhatsAppTemplate.status.in_([TemplateStatus.PENDING, TemplateStatus.DRAFT]),
                    )
                )
            ).scalars().all()
            if not pending:
                continue
            try:
                decrypt_secret(wa.access_token_encrypted)
            except Exception:
                continue
            _, updated = await sync_templates_from_meta(
                db,
                account_id=wa.account_id,
                whatsapp_account_id=wa.id,
            )
            synced_accounts += 1
            updated_templates += updated
    return {"accounts": synced_accounts, "updated": updated_templates}


@celery_app.task(name="watesly.templates.sync_pending")
def sync_pending_templates() -> dict:
    return run_async(_sync_pending_templates())
