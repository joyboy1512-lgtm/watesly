import io
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.deal import Deal, DealActivity
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User

DEAL_STAGES = ("lead", "qualified", "proposal", "won", "lost")


def deal_to_dict(deal: Deal, *, contact_name: str | None = None, contact_phone: str | None = None) -> dict:
    return {
        "id": str(deal.id),
        "title": deal.title,
        "stage": deal.stage,
        "amount": str(deal.amount),
        "currency": deal.currency or "KWD",
        "pipeline": deal.pipeline,
        "contact_id": str(deal.contact_id) if deal.contact_id else None,
        "contact_name": contact_name,
        "contact_phone": contact_phone,
        "organization_id": str(deal.organization_id) if deal.organization_id else None,
        "assigned_membership_id": str(deal.assigned_membership_id) if deal.assigned_membership_id else None,
        "description": deal.description,
        "probability": deal.probability or 0,
        "source": deal.source,
        "expected_close_date": deal.expected_close_date.isoformat() if deal.expected_close_date else None,
        "created_at": deal.created_at.isoformat() if deal.created_at else None,
        "updated_at": deal.updated_at.isoformat() if deal.updated_at else None,
    }


async def create_deal(
    db: AsyncSession,
    *,
    account_id: UUID,
    title: str,
    contact_id: UUID | None = None,
    stage: str = "lead",
    amount: Decimal = Decimal("0"),
    pipeline: str = "default",
    currency: str = "KWD",
    description: str | None = None,
    organization_id: UUID | None = None,
    assigned_membership_id: UUID | None = None,
    probability: int = 0,
    source: str | None = "manual",
    expected_close_date: datetime | None = None,
) -> Deal:
    item = Deal(
        account_id=account_id,
        contact_id=contact_id,
        title=title,
        stage=stage,
        amount=amount,
        pipeline=pipeline,
        currency=currency,
        description=description,
        organization_id=organization_id,
        assigned_membership_id=assigned_membership_id,
        probability=probability,
        source=source,
        expected_close_date=expected_close_date,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    await add_deal_activity(
        db,
        deal_id=item.id,
        activity_type="created",
        body=f"تم إنشاء الصفقة — المرحلة: {stage}",
        user_id=None,
    )
    return item


async def list_deals(
    db: AsyncSession,
    account_id: UUID,
    *,
    q: str | None = None,
    stage: str | None = None,
    pipeline: str | None = None,
    contact_id: UUID | None = None,
    organization_id: UUID | None = None,
    assigned_membership_id: UUID | None = None,
    limit: int = 500,
) -> list[dict]:
    stmt = (
        select(Deal, Contact.display_name, Contact.external_address)
        .outerjoin(Contact, Contact.id == Deal.contact_id)
        .where(Deal.account_id == account_id)
        .order_by(Deal.updated_at.desc())
        .limit(limit)
    )
    if stage:
        stmt = stmt.where(Deal.stage == stage)
    if pipeline:
        stmt = stmt.where(Deal.pipeline == pipeline)
    if contact_id:
        stmt = stmt.where(Deal.contact_id == contact_id)
    if organization_id:
        stmt = stmt.where(Deal.organization_id == organization_id)
    if assigned_membership_id:
        stmt = stmt.where(Deal.assigned_membership_id == assigned_membership_id)
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Deal.title.ilike(term), Contact.display_name.ilike(term), Contact.external_address.ilike(term)))

    rows = (await db.execute(stmt)).all()
    return [
        deal_to_dict(deal, contact_name=display_name, contact_phone=external_address)
        for deal, display_name, external_address in rows
    ]


async def get_deal(db: AsyncSession, *, account_id: UUID, deal_id: UUID) -> dict:
    row = (
        await db.execute(
            select(Deal, Contact.display_name, Contact.external_address, Organization.name)
            .outerjoin(Contact, Contact.id == Deal.contact_id)
            .outerjoin(Organization, Organization.id == Deal.organization_id)
            .where(Deal.id == deal_id, Deal.account_id == account_id)
        )
    ).first()
    if row is None:
        raise ValueError("DEAL_NOT_FOUND")
    deal, display_name, external_phone, org_name = row
    data = deal_to_dict(deal, contact_name=display_name, contact_phone=external_phone)
    data["organization_name"] = org_name
    return data


async def update_deal(
    db: AsyncSession,
    *,
    account_id: UUID,
    deal_id: UUID,
    **fields,
) -> Deal:
    deal = await db.get(Deal, deal_id)
    if deal is None or deal.account_id != account_id:
        raise ValueError("DEAL_NOT_FOUND")
    old_stage = deal.stage
    for key, value in fields.items():
        if hasattr(deal, key):
            setattr(deal, key, value)
    await db.commit()
    await db.refresh(deal)
    new_stage = fields.get("stage")
    if new_stage is not None and new_stage != old_stage:
        await add_deal_activity(
            db,
            deal_id=deal.id,
            activity_type="stage_change",
            body=f"انتقلت من {old_stage} إلى {deal.stage}",
            user_id=None,
        )
        if deal.stage == "won":
            from app.services.webhook_dispatch import dispatch_account_webhook

            await dispatch_account_webhook(
                db,
                account_id=account_id,
                event_type="deal.won",
                payload={
                    "deal_id": str(deal.id),
                    "title": deal.title,
                    "amount": str(deal.amount or 0),
                    "contact_id": str(deal.contact_id) if deal.contact_id else None,
                },
            )
    return deal


async def update_deal_stage(db: AsyncSession, *, account_id: UUID, deal_id: UUID, stage: str) -> Deal:
    return await update_deal(db, account_id=account_id, deal_id=deal_id, stage=stage)


async def delete_deal(db: AsyncSession, *, account_id: UUID, deal_id: UUID) -> None:
    deal = await db.get(Deal, deal_id)
    if deal is None or deal.account_id != account_id:
        raise ValueError("DEAL_NOT_FOUND")
    await db.delete(deal)
    await db.commit()


async def add_deal_activity(
    db: AsyncSession, *, deal_id: UUID, activity_type: str, body: str, user_id: UUID | None
) -> DealActivity:
    item = DealActivity(deal_id=deal_id, activity_type=activity_type, body=body, created_by_user_id=user_id)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def list_deal_activities(db: AsyncSession, deal_id: UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(DealActivity, User.full_name)
            .outerjoin(User, User.id == DealActivity.created_by_user_id)
            .where(DealActivity.deal_id == deal_id)
            .order_by(DealActivity.created_at.desc())
        )
    ).all()
    return [
        {
            "id": str(activity.id),
            "activity_type": activity.activity_type,
            "body": activity.body,
            "created_by_name": full_name,
            "created_at": activity.created_at.isoformat() if activity.created_at else None,
        }
        for activity, full_name in rows
    ]


async def crm_stats(db: AsyncSession, *, account_id: UUID) -> dict:
    since = datetime.now(UTC) - timedelta(days=30)
    deals = list(
        (await db.execute(select(Deal).where(Deal.account_id == account_id))).scalars().all()
    )
    open_deals = [d for d in deals if d.stage not in ("won", "lost")]
    won_recent = [d for d in deals if d.stage == "won" and d.updated_at and d.updated_at >= since]
    pipeline_value = sum(float(d.amount or 0) for d in open_deals)
    won_value = sum(float(d.amount or 0) for d in won_recent)
    by_stage = {stage: len([d for d in deals if d.stage == stage]) for stage in DEAL_STAGES}
    return {
        "total": len(deals),
        "open": len(open_deals),
        "won_month": len(won_recent),
        "pipeline_value": round(pipeline_value, 3),
        "won_value_month": round(won_value, 3),
        "by_stage": by_stage,
    }


async def bulk_update_stage(
    db: AsyncSession,
    *,
    account_id: UUID,
    deal_ids: list[UUID],
    stage: str,
) -> int:
    updated = 0
    for deal_id in deal_ids:
        try:
            await update_deal_stage(db, account_id=account_id, deal_id=deal_id, stage=stage)
            updated += 1
        except ValueError:
            continue
    return updated


async def maybe_auto_create_deal_from_inbound(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    organization_id: UUID | None,
    text_body: str,
) -> Deal | None:
    from app.services.ai_assistant import detect_intent

    intent = detect_intent(text_body)
    purchase_signals = intent.get("intent") in ("purchase", "question") and any(
        w in text_body.lower() for w in ("شراء", "طلب", "order", "buy", "سعر", "price", "عرض")
    )
    if not purchase_signals and intent.get("intent") != "purchase":
        return None

    existing = (
        await db.execute(
            select(Deal.id)
            .where(
                Deal.account_id == account_id,
                Deal.contact_id == contact_id,
                Deal.stage.notin_(("won", "lost")),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        return None

    title = (text_body.strip()[:120] or "فرصة من WhatsApp").replace("\n", " ")
    return await create_deal(
        db,
        account_id=account_id,
        contact_id=contact_id,
        title=title,
        stage="lead",
        organization_id=organization_id,
        probability=35 if intent.get("intent") == "purchase" else 20,
        source="inbound",
        description=text_body[:500],
    )


async def create_deal_from_conversation(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
    title: str | None = None,
) -> Deal:
    from app.models.conversation import Conversation

    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise ValueError("CONTACT_NOT_FOUND")

    from app.models.message import Message

    last_inbound = (
        await db.execute(
            select(Message.text_body)
            .where(Message.conversation_id == conversation_id, Message.text_body.is_not(None))
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    deal_title = title or (last_inbound[:120] if last_inbound else f"صفقة — {contact.display_name or contact.external_address}")
    return await create_deal(
        db,
        account_id=account_id,
        contact_id=contact.id,
        title=deal_title,
        organization_id=contact.organization_id,
        source="conversation",
        description=last_inbound[:500] if last_inbound else None,
    )


async def crm_report(db: AsyncSession, *, account_id: UUID) -> dict:
    stats = await crm_stats(db, account_id=account_id)
    deals = await list_deals(db, account_id, limit=500)
    top_open = [d for d in deals if d["stage"] not in ("won", "lost")][:20]
    recent_won = [d for d in deals if d["stage"] == "won"][:20]
    return {
        "summary": stats,
        "top_open": top_open,
        "recent_won": recent_won,
        "funnel": [{"stage": s, "count": stats["by_stage"].get(s, 0)} for s in DEAL_STAGES],
    }


async def export_deals_csv(db: AsyncSession, account_id: UUID, *, deal_ids: list[UUID] | None = None) -> str:
    import csv

    rows = await list_deals(db, account_id, limit=5000)
    if deal_ids:
        id_set = {str(i) for i in deal_ids}
        rows = [r for r in rows if r["id"] in id_set]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["title", "stage", "amount", "currency", "contact", "pipeline", "probability", "source"])
    for item in rows:
        writer.writerow([
            item["title"],
            item["stage"],
            item["amount"],
            item["currency"],
            item["contact_name"] or item["contact_phone"] or "",
            item["pipeline"],
            item["probability"],
            item["source"] or "",
        ])
    return buffer.getvalue()


async def export_deals_xlsx(db: AsyncSession, account_id: UUID, *, deal_ids: list[UUID] | None = None) -> bytes:
    from openpyxl import Workbook

    rows = await list_deals(db, account_id, limit=5000)
    if deal_ids:
        id_set = {str(i) for i in deal_ids}
        rows = [r for r in rows if r["id"] in id_set]
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "CRM"
    sheet.append(["title", "stage", "amount", "currency", "contact", "pipeline", "probability", "source"])
    for item in rows:
        sheet.append([
            item["title"],
            item["stage"],
            item["amount"],
            item["currency"],
            item["contact_name"] or item["contact_phone"] or "",
            item["pipeline"],
            item["probability"],
            item["source"] or "",
        ])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()
