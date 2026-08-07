"""Process Meta message_template_status_update webhooks."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.realtime.event_bus import publish_event
from app.services.notifications import create_notification


def _map_template_status(event: str) -> TemplateStatus | None:
    normalized = event.strip().upper()
    mapping = {
        "APPROVED": TemplateStatus.APPROVED,
        "REJECTED": TemplateStatus.REJECTED,
        "PAUSED": TemplateStatus.PAUSED,
        "DISABLED": TemplateStatus.DISABLED,
        "PENDING": TemplateStatus.PENDING,
        "IN_APPEAL": TemplateStatus.PENDING,
    }
    return mapping.get(normalized)


async def process_template_status_update(
    db: AsyncSession,
    *,
    waba_id: str,
    value: dict,
) -> bool:
    event = str(value.get("event", "")).strip()
    template_name = str(value.get("message_template_name", "")).strip()
    template_language = str(value.get("message_template_language", "")).strip()
    meta_template_id = value.get("message_template_id")
    reason = value.get("reason")
    if not template_name:
        return False

    accounts = list(
        (
            await db.execute(select(WhatsAppAccount).where(WhatsAppAccount.waba_id == waba_id))
        ).scalars().all()
    )
    if not accounts:
        return False

    updated = False
    for account in accounts:
        query = select(WhatsAppTemplate).where(
            WhatsAppTemplate.whatsapp_account_id == account.id,
            WhatsAppTemplate.name == template_name,
        )
        if template_language:
            query = query.where(WhatsAppTemplate.language == template_language)
        template = (await db.execute(query)).scalar_one_or_none()
        if template is None:
            continue

        new_status = _map_template_status(event)
        if new_status is not None:
            template.status = new_status
        if meta_template_id:
            template.meta_template_id = str(meta_template_id)
        if reason and str(reason).upper() not in {"", "NONE"}:
            template.meta_status_detail = str(reason)[:4000]
        elif new_status == TemplateStatus.APPROVED:
            template.meta_status_detail = None

        await publish_event(
            account.account_id,
            {
                "type": "template.status_updated",
                "template_id": str(template.id),
                "name": template.name,
                "status": template.status.value,
                "reason": template.meta_status_detail,
            },
        )

        title = "تحديث قالب WhatsApp"
        if new_status == TemplateStatus.APPROVED:
            body = f"تم اعتماد القالب «{template.name}» من Meta."
        elif new_status == TemplateStatus.REJECTED:
            body = f"رفض Meta القالب «{template.name}»."
            if template.meta_status_detail:
                body = f"{body} السبب: {template.meta_status_detail}"
        else:
            body = f"تغيّرت حالة القالب «{template.name}» إلى {template.status.value}."

        await create_notification(
            db,
            account_id=account.account_id,
            user_id=None,
            type="template_status",
            title=title,
            body=body,
            data={"template_id": str(template.id), "status": template.status.value},
        )
        updated = True

    if updated:
        await db.commit()
    return updated
