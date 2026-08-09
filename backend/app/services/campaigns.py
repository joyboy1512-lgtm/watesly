from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignStatus
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.schemas.campaign import CampaignCreateRequest
from app.services.outbox import add_outbox_event


async def create_campaign(db: AsyncSession, *, account_id: UUID, user_id: UUID, payload: CampaignCreateRequest) -> Campaign:
    wa = await db.get(WhatsAppAccount, payload.whatsapp_account_id)
    template = await db.get(WhatsAppTemplate, payload.template_id)
    if wa is None or wa.account_id != account_id:
        raise ValueError("INVALID_WHATSAPP_ACCOUNT")
    if wa.organization_id != payload.organization_id:
        raise ValueError("ORGANIZATION_MISMATCH")
    if template is None or template.account_id != account_id:
        raise ValueError("INVALID_TEMPLATE")
    if template.whatsapp_account_id != wa.id:
        raise ValueError("TEMPLATE_ACCOUNT_MISMATCH")
    if template.status != TemplateStatus.APPROVED:
        raise ValueError("TEMPLATE_NOT_APPROVED")

    contact_ids = [r.contact_id for r in payload.recipients]
    if len(set(contact_ids)) != len(contact_ids):
        raise ValueError("DUPLICATE_RECIPIENT")
    contact_query = select(Contact.id, Contact.marketing_opt_in).where(
        Contact.account_id == account_id,
        Contact.organization_id == payload.organization_id,
        Contact.deleted_at.is_(None),
        Contact.id.in_(contact_ids),
    )
    result = await db.execute(contact_query)
    rows = {row[0]: row[1] for row in result.all()}
    if set(rows.keys()) != set(contact_ids):
        raise ValueError("INVALID_RECIPIENT")

    recipients = payload.recipients
    if payload.exclude_marketing_opt_out:
        recipients = [item for item in recipients if rows.get(item.contact_id) is not False]
        if not recipients:
            raise ValueError("ALL_RECIPIENTS_OPTED_OUT")

    campaign = Campaign(
        account_id=account_id,
        organization_id=payload.organization_id,
        whatsapp_account_id=payload.whatsapp_account_id,
        template_id=payload.template_id,
        created_by_user_id=user_id,
        name=payload.name,
        status=CampaignStatus.DRAFT,
        scheduled_at=payload.scheduled_at,
        max_recipients=min(max(len(recipients), 1), 10000),
        requires_approval=True,
        include_opt_out_option=payload.include_opt_out_option,
    )
    db.add(campaign)
    await db.flush()
    db.add_all([CampaignRecipient(
        campaign_id=campaign.id,
        contact_id=item.contact_id,
        template_parameters=item.template_parameters,
    ) for item in recipients])
    await add_outbox_event(db, account_id=account_id, event_type="campaign.created", aggregate_type="campaign", aggregate_id=str(campaign.id), payload={"campaign_id": str(campaign.id)})
    await db.commit()
    await db.refresh(campaign)
    return campaign


async def list_campaigns(db: AsyncSession, account_id: UUID, *, limit: int = 100) -> list[Campaign]:
    result = await db.execute(
        select(Campaign)
        .where(Campaign.account_id == account_id)
        .order_by(Campaign.created_at.desc())
        .limit(min(max(limit, 1), 200))
    )
    return list(result.scalars().all())


async def list_campaigns_with_reports(
    db: AsyncSession, account_id: UUID, *, limit: int = 100
) -> list[dict]:
    campaigns = await list_campaigns(db, account_id, limit=limit)
    items: list[dict] = []
    for campaign in campaigns:
        report = await get_campaign_report(
            db, account_id=account_id, campaign_id=campaign.id
        )
        status = campaign.status.value if hasattr(campaign.status, "value") else str(campaign.status)
        items.append({
            "id": campaign.id,
            "organization_id": campaign.organization_id,
            "whatsapp_account_id": campaign.whatsapp_account_id,
            "template_id": campaign.template_id,
            "name": campaign.name,
            "status": status,
            "scheduled_at": campaign.scheduled_at,
            "started_at": campaign.started_at,
            "completed_at": campaign.completed_at,
            "report": report,
        })
    return items


async def get_campaign(db: AsyncSession, *, account_id: UUID, campaign_id: UUID) -> Campaign:
    campaign = await db.get(Campaign, campaign_id)
    if campaign is None or campaign.account_id != account_id:
        raise ValueError("CAMPAIGN_NOT_FOUND")
    return campaign


async def recipient_count(db: AsyncSession, campaign_id: UUID) -> int:
    return int((await db.scalar(select(func.count(CampaignRecipient.id)).where(CampaignRecipient.campaign_id == campaign_id))) or 0)


async def approve_campaign(db: AsyncSession, *, account_id: UUID, campaign_id: UUID, user_id: UUID) -> Campaign:
    campaign = await get_campaign(db, account_id=account_id, campaign_id=campaign_id)
    if campaign.status not in {CampaignStatus.DRAFT, CampaignStatus.PAUSED}:
        raise ValueError("CAMPAIGN_CANNOT_BE_APPROVED")
    count = await recipient_count(db, campaign.id)
    if count > campaign.max_recipients:
        raise ValueError("RECIPIENT_LIMIT_EXCEEDED")
    campaign.approved_by_user_id = user_id
    campaign.approved_at = datetime.now(UTC)
    await db.commit(); await db.refresh(campaign)
    return campaign


async def prepare_campaign_start(db: AsyncSession, *, account_id: UUID, campaign_id: UUID) -> Campaign:
    campaign = (await db.execute(select(Campaign).where(Campaign.id==campaign_id,Campaign.account_id==account_id).with_for_update())).scalar_one_or_none()
    if campaign is None: raise ValueError("CAMPAIGN_NOT_FOUND")
    if campaign.status not in {CampaignStatus.DRAFT, CampaignStatus.SCHEDULED, CampaignStatus.PAUSED}:
        raise ValueError("CAMPAIGN_CANNOT_START")
    if campaign.requires_approval and campaign.approved_at is None:
        raise ValueError("CAMPAIGN_APPROVAL_REQUIRED")
    if await recipient_count(db, campaign.id) > campaign.max_recipients:
        raise ValueError("RECIPIENT_LIMIT_EXCEEDED")
    campaign.status = CampaignStatus.SCHEDULED
    campaign.execution_token = uuid4()
    campaign.active_task_id = None
    campaign.paused_at = None
    campaign.cancelled_reason = None
    await db.commit(); await db.refresh(campaign)
    return campaign


async def pause_campaign(db: AsyncSession, *, account_id: UUID, campaign_id: UUID) -> Campaign:
    campaign = await get_campaign(db, account_id=account_id, campaign_id=campaign_id)
    if campaign.status not in {CampaignStatus.SCHEDULED, CampaignStatus.RUNNING}:
        raise ValueError("CAMPAIGN_CANNOT_PAUSE")
    campaign.status = CampaignStatus.PAUSED
    campaign.paused_at = datetime.now(UTC)
    await db.commit(); await db.refresh(campaign)
    return campaign


async def cancel_campaign(db: AsyncSession, *, account_id: UUID, campaign_id: UUID, reason: str) -> Campaign:
    campaign = await get_campaign(db, account_id=account_id, campaign_id=campaign_id)
    if campaign.status in {CampaignStatus.COMPLETED, CampaignStatus.CANCELLED}:
        raise ValueError("CAMPAIGN_CANNOT_CANCEL")
    campaign.status = CampaignStatus.CANCELLED
    campaign.cancelled_reason = reason[:2000]
    campaign.completed_at = datetime.now(UTC)
    await db.commit(); await db.refresh(campaign)
    return campaign


async def get_campaign_report(db: AsyncSession, *, account_id: UUID, campaign_id: UUID) -> dict:
    await get_campaign(db, account_id=account_id, campaign_id=campaign_id)
    result = await db.execute(select(CampaignRecipient.status, func.count(CampaignRecipient.id)).where(CampaignRecipient.campaign_id == campaign_id).group_by(CampaignRecipient.status))
    counts: dict[CampaignRecipientStatus, int] = {}
    for status, count in result.all():
        key = status if isinstance(status, CampaignRecipientStatus) else CampaignRecipientStatus(str(status))
        counts[key] = counts.get(key, 0) + int(count)
    total = sum(counts.values()); delivered = counts.get(CampaignRecipientStatus.DELIVERED, 0); read = counts.get(CampaignRecipientStatus.READ, 0); sent = counts.get(CampaignRecipientStatus.SENT, 0)
    return {"total": total, "pending": counts.get(CampaignRecipientStatus.PENDING, 0), "queued": counts.get(CampaignRecipientStatus.QUEUED, 0), "sent": sent, "delivered": delivered, "read": read, "failed": counts.get(CampaignRecipientStatus.FAILED, 0), "skipped": counts.get(CampaignRecipientStatus.SKIPPED, 0), "delivery_rate": round(((delivered + read) / max(sent + delivered + read, 1)) * 100, 2), "read_rate": round((read / max(delivered + read, 1)) * 100, 2)}


async def list_campaign_recipients(
    db: AsyncSession, *, account_id: UUID, campaign_id: UUID
) -> list[dict]:
    await get_campaign(db, account_id=account_id, campaign_id=campaign_id)
    rows = await db.execute(
        select(CampaignRecipient, Contact)
        .join(Contact, Contact.id == CampaignRecipient.contact_id)
        .where(CampaignRecipient.campaign_id == campaign_id)
        .order_by(CampaignRecipient.status.asc(), Contact.external_address.asc())
    )
    items: list[dict] = []
    for recipient, contact in rows.all():
        status = recipient.status.value if hasattr(recipient.status, "value") else str(recipient.status)
        items.append({
            "contact_id": str(contact.id),
            "display_name": contact.display_name,
            "phone": contact.external_address,
            "status": status,
            "error_message": recipient.error_message,
        })
    return items


async def export_campaign_recipients_csv(
    db: AsyncSession, *, account_id: UUID, campaign_id: UUID
) -> str:
    import csv
    import io

    items = await list_campaign_recipients(db, account_id=account_id, campaign_id=campaign_id)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["name", "phone", "status", "error"])
    for item in items:
        writer.writerow([
            item["display_name"] or "",
            item["phone"],
            item["status"],
            item["error_message"] or "",
        ])
    return buffer.getvalue()


async def export_campaign_recipients_xlsx(
    db: AsyncSession, *, account_id: UUID, campaign_id: UUID
) -> bytes:
    import io

    from openpyxl import Workbook

    items = await list_campaign_recipients(db, account_id=account_id, campaign_id=campaign_id)
    workbook = Workbook()
    workbook.remove(workbook.active)

    summary = await get_campaign_report(db, account_id=account_id, campaign_id=campaign_id)
    summary_sheet = workbook.create_sheet("ملخص")
    summary_sheet.append(["المؤشر", "القيمة"])
    for key, value in summary.items():
        summary_sheet.append([key, value])

    detail = workbook.create_sheet("كل الأرقام")
    detail.append(["الاسم", "الرقم", "الحالة", "سبب الفشل"])
    for item in items:
        detail.append([
            item["display_name"] or "",
            item["phone"],
            item["status"],
            item["error_message"] or "",
        ])

    for status in ("sent", "delivered", "read", "failed", "pending"):
        group = [i for i in items if i["status"] == status]
        if not group:
            continue
        sheet = workbook.create_sheet(status[:31])
        sheet.append(["الاسم", "الرقم", "سبب الفشل"])
        for item in group:
            sheet.append([item["display_name"] or "", item["phone"], item["error_message"] or ""])

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
