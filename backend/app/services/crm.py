import io
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.deal import Deal, DealActivity
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User

DEAL_STAGES = ("lead", "qualified", "proposal", "won", "lost")
LOSS_REASONS = ("price", "no_reply", "unavailable", "competitor", "other", "unspecified")
OPEN_STAGES = ("lead", "qualified", "proposal")


def deal_to_dict(
    deal: Deal,
    *,
    contact_name: str | None = None,
    contact_phone: str | None = None,
    assignee_name: str | None = None,
    conversation_id: UUID | None = None,
) -> dict:
    amount_value = deal.amount
    return {
        "id": str(deal.id),
        "title": deal.title,
        "stage": deal.stage,
        "amount": str(amount_value) if amount_value is not None else None,
        "amount_recorded": amount_value is not None,
        "currency": deal.currency or "KWD",
        "pipeline": deal.pipeline,
        "contact_id": str(deal.contact_id) if deal.contact_id else None,
        "contact_name": contact_name,
        "contact_phone": contact_phone,
        "organization_id": str(deal.organization_id) if deal.organization_id else None,
        "assigned_membership_id": str(deal.assigned_membership_id) if deal.assigned_membership_id else None,
        "assignee_name": assignee_name,
        "description": deal.description,
        "probability": deal.probability or 0,
        "source": deal.source,
        "expected_close_date": deal.expected_close_date.isoformat() if deal.expected_close_date else None,
        "loss_reason": deal.loss_reason or ("unspecified" if deal.stage == "lost" else None),
        "loss_reason_detail": deal.loss_reason_detail,
        "next_step": deal.next_step,
        "next_step_at": deal.next_step_at.isoformat() if deal.next_step_at else None,
        "conversation_id": str(conversation_id or deal.conversation_id)
        if (conversation_id or deal.conversation_id)
        else None,
        "created_at": deal.created_at.isoformat() if deal.created_at else None,
        "updated_at": deal.updated_at.isoformat() if deal.updated_at else None,
    }


def _day_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = now or datetime.now(UTC)
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start, end


def _apply_quick_filter(stmt, *, quick_filter: str | None, membership_id: UUID | None):
    if not quick_filter:
        return stmt
    now = datetime.now(UTC)
    start, end = _day_bounds(now)
    if quick_filter == "my_today":
        if membership_id is None:
            return stmt.where(False)
        due = or_(
            and_(Deal.next_step_at.is_not(None), Deal.next_step_at >= start, Deal.next_step_at < end),
            and_(
                Deal.expected_close_date.is_not(None),
                Deal.expected_close_date >= start,
                Deal.expected_close_date < end,
            ),
        )
        return stmt.where(
            Deal.assigned_membership_id == membership_id,
            Deal.stage.in_(OPEN_STAGES),
            due,
        )
    if quick_filter == "overdue":
        return stmt.where(
            Deal.stage.in_(OPEN_STAGES),
            or_(
                and_(Deal.next_step_at.is_not(None), Deal.next_step_at < now),
                and_(Deal.expected_close_date.is_not(None), Deal.expected_close_date < now),
            ),
        )
    if quick_filter == "unassigned":
        return stmt.where(Deal.stage.in_(OPEN_STAGES), Deal.assigned_membership_id.is_(None))
    if quick_filter.startswith("loss:"):
        reason = quick_filter.split(":", 1)[1] or "unspecified"
        stmt = stmt.where(Deal.stage == "lost")
        if reason == "unspecified":
            return stmt.where(
                or_(Deal.loss_reason.is_(None), Deal.loss_reason == "", Deal.loss_reason == "unspecified")
            )
        return stmt.where(Deal.loss_reason == reason)
    return stmt


async def create_deal(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership=None,
    title: str,
    contact_id: UUID | None = None,
    stage: str = "lead",
    amount: Decimal | None = None,
    pipeline: str = "default",
    currency: str = "KWD",
    description: str | None = None,
    organization_id: UUID | None = None,
    assigned_membership_id: UUID | None = None,
    probability: int = 0,
    source: str | None = "manual",
    expected_close_date: datetime | None = None,
    next_step: str | None = None,
    next_step_at: datetime | None = None,
    conversation_id: UUID | None = None,
    loss_reason: str | None = None,
    loss_reason_detail: str | None = None,
) -> Deal:
    from app.services.membership_access import ensure_membership_organization_access

    if membership is not None:
        if organization_id is None:
            raise ValueError("ORGANIZATION_REQUIRED")
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=organization_id,
        )
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
        next_step=next_step,
        next_step_at=next_step_at,
        conversation_id=conversation_id,
        loss_reason=loss_reason,
        loss_reason_detail=loss_reason_detail,
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
    membership=None,
    q: str | None = None,
    stage: str | None = None,
    pipeline: str | None = None,
    contact_id: UUID | None = None,
    organization_id: UUID | None = None,
    assigned_membership_id: UUID | None = None,
    quick_filter: str | None = None,
    source: str | None = None,
    ids: list[UUID] | None = None,
    updated_since: datetime | None = None,
    limit: int = 500,
) -> list[dict]:
    from app.services.membership_access import organization_scope_clauses

    stmt = (
        select(Deal, Contact.display_name, Contact.external_address, User.full_name)
        .outerjoin(Contact, Contact.id == Deal.contact_id)
        .outerjoin(Membership, Membership.id == Deal.assigned_membership_id)
        .outerjoin(User, User.id == Membership.user_id)
        .where(Deal.account_id == account_id)
        .order_by(Deal.updated_at.desc())
        .limit(limit)
    )
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=Deal.organization_id,
        ):
            stmt = stmt.where(clause)
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
    if source:
        stmt = stmt.where(Deal.source == source)
    if ids:
        stmt = stmt.where(Deal.id.in_(ids))
    if updated_since is not None:
        stmt = stmt.where(Deal.updated_at >= updated_since)
    membership_id = getattr(membership, "id", None) if membership is not None else None
    stmt = _apply_quick_filter(stmt, quick_filter=quick_filter, membership_id=membership_id)
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(Deal.title.ilike(term), Contact.display_name.ilike(term), Contact.external_address.ilike(term)))

    rows = (await db.execute(stmt)).all()
    return [
        deal_to_dict(
            deal,
            contact_name=display_name,
            contact_phone=external_address,
            assignee_name=assignee_name,
        )
        for deal, display_name, external_address, assignee_name in rows
    ]


async def get_deal(
    db: AsyncSession,
    *,
    account_id: UUID,
    deal_id: UUID,
    membership=None,
) -> dict:
    from app.services.membership_access import ensure_membership_organization_access

    row = (
        await db.execute(
            select(Deal, Contact.display_name, Contact.external_address, Organization.name, User.full_name)
            .outerjoin(Contact, Contact.id == Deal.contact_id)
            .outerjoin(Organization, Organization.id == Deal.organization_id)
            .outerjoin(Membership, Membership.id == Deal.assigned_membership_id)
            .outerjoin(User, User.id == Membership.user_id)
            .where(Deal.id == deal_id, Deal.account_id == account_id)
        )
    ).first()
    if row is None:
        raise ValueError("DEAL_NOT_FOUND")
    deal, display_name, external_phone, org_name, assignee_name = row
    if membership is not None and deal.organization_id is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=deal.organization_id,
        )
    elif membership is not None and deal.organization_id is None:
        raise ValueError("ACCESS_FORBIDDEN")
    conversation_id = deal.conversation_id
    if conversation_id is None and deal.contact_id is not None:
        from app.models.conversation import Conversation

        conversation_id = (
            await db.execute(
                select(Conversation.id)
                .where(
                    Conversation.account_id == account_id,
                    Conversation.contact_id == deal.contact_id,
                )
                .order_by(Conversation.updated_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    data = deal_to_dict(
        deal,
        contact_name=display_name,
        contact_phone=external_phone,
        assignee_name=assignee_name,
        conversation_id=conversation_id,
    )
    data["organization_name"] = org_name
    data["stage_history"] = [
        item
        for item in await list_deal_activities(db, deal.id)
        if item["activity_type"] in {"stage_change", "created", "lost_reason"}
    ]
    return data


async def update_deal(
    db: AsyncSession,
    *,
    account_id: UUID,
    deal_id: UUID,
    membership=None,
    **fields,
) -> Deal:
    deal = await db.get(Deal, deal_id)
    if deal is None or deal.account_id != account_id:
        raise ValueError("DEAL_NOT_FOUND")
    if membership is not None and deal.organization_id is not None:
        from app.services.membership_access import ensure_membership_organization_access

        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=deal.organization_id,
        )
    elif membership is not None:
        raise ValueError("ACCESS_FORBIDDEN")
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
            try:
                from app.models.contact import Contact
                from app.workers.growth_tasks import send_meta_capi_purchase

                phone = None
                if deal.contact_id:
                    contact = await db.get(Contact, deal.contact_id)
                    phone = getattr(contact, "external_address", None) if contact else None
                amount_val = float(deal.amount) if deal.amount is not None else None
                send_meta_capi_purchase.delay(
                    str(account_id),
                    phone,
                    amount_val,
                    deal.currency or "KWD",
                    deal.title,
                    str(deal.id),
                )
            except Exception:
                pass
    return deal


async def update_deal_stage(
    db: AsyncSession,
    *,
    account_id: UUID,
    deal_id: UUID,
    stage: str,
    loss_reason: str | None = None,
    loss_reason_detail: str | None = None,
    membership=None,
) -> Deal:
    fields: dict = {"stage": stage}
    if stage == "lost":
        reason = (loss_reason or "unspecified").strip() or "unspecified"
        if reason not in LOSS_REASONS:
            raise ValueError("INVALID_LOSS_REASON")
        fields["loss_reason"] = reason
        fields["loss_reason_detail"] = loss_reason_detail
    elif stage != "lost":
        fields["loss_reason"] = None
        fields["loss_reason_detail"] = None
    deal = await update_deal(db, account_id=account_id, deal_id=deal_id, membership=membership, **fields)
    if stage == "lost":
        await add_deal_activity(
            db,
            deal_id=deal.id,
            activity_type="lost_reason",
            body=f"سبب الخسارة: {deal.loss_reason}"
            + (f" — {deal.loss_reason_detail}" if deal.loss_reason_detail else ""),
            user_id=None,
        )
    return deal


async def delete_deal(
    db: AsyncSession, *, account_id: UUID, deal_id: UUID, membership=None
) -> None:
    deal = await db.get(Deal, deal_id)
    if deal is None or deal.account_id != account_id:
        raise ValueError("DEAL_NOT_FOUND")
    if membership is not None and deal.organization_id is not None:
        from app.services.membership_access import ensure_membership_organization_access

        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=deal.organization_id,
        )
    elif membership is not None:
        raise ValueError("ACCESS_FORBIDDEN")
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


async def crm_stats(db: AsyncSession, *, account_id: UUID, membership=None) -> dict:
    from app.services.membership_access import organization_scope_clauses

    since = datetime.now(UTC) - timedelta(days=30)
    query = select(Deal).where(Deal.account_id == account_id)
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=Deal.organization_id,
        ):
            query = query.where(clause)
    deals = list((await db.execute(query)).scalars().all())
    open_deals = [d for d in deals if d.stage not in ("won", "lost")]
    won_recent = [d for d in deals if d.stage == "won" and d.updated_at and d.updated_at >= since]
    pipeline_value = sum(float(d.amount) for d in open_deals if d.amount is not None)
    won_value = sum(float(d.amount) for d in won_recent if d.amount is not None)
    by_stage = {stage: len([d for d in deals if d.stage == stage]) for stage in DEAL_STAGES}
    lost = [d for d in deals if d.stage == "lost"]
    loss_reasons = {reason: 0 for reason in LOSS_REASONS}
    for deal in lost:
        key = deal.loss_reason if deal.loss_reason in LOSS_REASONS else "unspecified"
        if not deal.loss_reason:
            key = "unspecified"
        loss_reasons[key] = loss_reasons.get(key, 0) + 1
    return {
        "total": len(deals),
        "open": len(open_deals),
        "won_month": len(won_recent),
        "pipeline_value": round(pipeline_value, 3),
        "won_value_month": round(won_value, 3),
        "by_stage": by_stage,
        "loss_reasons": loss_reasons,
        "lost_total": len(lost),
    }


async def bulk_update_stage(
    db: AsyncSession,
    *,
    account_id: UUID,
    deal_ids: list[UUID],
    stage: str,
    loss_reason: str | None = None,
    loss_reason_detail: str | None = None,
) -> int:
    updated = 0
    for deal_id in deal_ids:
        try:
            await update_deal_stage(
                db,
                account_id=account_id,
                deal_id=deal_id,
                stage=stage,
                loss_reason=loss_reason,
                loss_reason_detail=loss_reason_detail,
            )
            updated += 1
        except ValueError:
            continue
    return updated


async def follow_up_counts(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership=None,
    organization_id: UUID | None = None,
) -> dict:
    """Counts for CRM quick filters under the same org scope as list_deals."""
    from app.services.membership_access import organization_scope_clauses

    base = select(Deal).where(Deal.account_id == account_id)
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=Deal.organization_id,
        ):
            base = base.where(clause)
    if organization_id:
        base = base.where(Deal.organization_id == organization_id)
    deals = list((await db.execute(base)).scalars().all())
    now = datetime.now(UTC)
    start, end = _day_bounds(now)
    membership_id = getattr(membership, "id", None) if membership is not None else None

    def is_due_today(deal: Deal) -> bool:
        if deal.next_step_at and start <= deal.next_step_at < end:
            return True
        if deal.expected_close_date and start <= deal.expected_close_date < end:
            return True
        return False

    def is_overdue(deal: Deal) -> bool:
        if deal.next_step_at and deal.next_step_at < now:
            return True
        if deal.expected_close_date and deal.expected_close_date < now:
            return True
        return False

    open_deals = [d for d in deals if d.stage in OPEN_STAGES]
    my_today = [
        d
        for d in open_deals
        if membership_id and d.assigned_membership_id == membership_id and is_due_today(d)
    ]
    overdue = [d for d in open_deals if is_overdue(d)]
    unassigned = [d for d in open_deals if d.assigned_membership_id is None]
    lost = [d for d in deals if d.stage == "lost"]
    loss_reasons = {reason: 0 for reason in LOSS_REASONS}
    for deal in lost:
        key = deal.loss_reason if deal.loss_reason in LOSS_REASONS and deal.loss_reason else "unspecified"
        loss_reasons[key] = loss_reasons.get(key, 0) + 1
    return {
        "my_today": len(my_today),
        "overdue": len(overdue),
        "unassigned": len(unassigned),
        "lost_total": len(lost),
        "loss_reasons": loss_reasons,
    }


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
        conversation_id=conversation_id,
    )


async def crm_report(db: AsyncSession, *, account_id: UUID, membership=None) -> dict:
    stats = await crm_stats(db, account_id=account_id, membership=membership)
    deals = await list_deals(db, account_id, membership=membership, limit=500)
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
    writer.writerow(
        [
            "title",
            "stage",
            "amount",
            "currency",
            "contact",
            "assignee",
            "pipeline",
            "probability",
            "source",
            "loss_reason",
            "next_step",
            "next_step_at",
        ]
    )
    for item in rows:
        writer.writerow([
            item["title"],
            item["stage"],
            item["amount"] if item["amount"] is not None else "",
            item["currency"],
            item["contact_name"] or item["contact_phone"] or "",
            item.get("assignee_name") or "",
            item["pipeline"],
            item["probability"],
            item["source"] or "",
            item.get("loss_reason") or "",
            item.get("next_step") or "",
            item.get("next_step_at") or "",
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
    sheet.append(
        [
            "title",
            "stage",
            "amount",
            "currency",
            "contact",
            "assignee",
            "pipeline",
            "probability",
            "source",
            "loss_reason",
            "next_step",
            "next_step_at",
        ]
    )
    for item in rows:
        sheet.append([
            item["title"],
            item["stage"],
            item["amount"] if item["amount"] is not None else "",
            item["currency"],
            item["contact_name"] or item["contact_phone"] or "",
            item.get("assignee_name") or "",
            item["pipeline"],
            item["probability"],
            item["source"] or "",
            item.get("loss_reason") or "",
            item.get("next_step") or "",
            item.get("next_step_at") or "",
        ])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()
