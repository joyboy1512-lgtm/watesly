from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_rating import ConversationRating
from app.models.deal import Deal
from app.models.membership import Membership
from app.models.message import Message, MessageDirection
from app.models.monthly_active_contact import MonthlyActiveContact
from app.models.channel import Channel

SLA_FIRST_RESPONSE_MINUTES = 15
SLA_RESOLUTION_MINUTES = 240
DEAL_STAGES = ("lead", "qualified", "proposal", "won", "lost")


def _pct_change(current: float | int, previous: float | int) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def _period_bounds(days: int) -> tuple[datetime, datetime, datetime]:
    now = datetime.now(UTC)
    since = now - timedelta(days=days)
    prev_since = since - timedelta(days=days)
    return since, prev_since, now


async def agent_performance(db: AsyncSession, *, account_id: UUID, days: int = 30) -> list[dict]:
    since, _, _ = _period_bounds(days)
    members = list(
        (
            await db.execute(
                select(Membership)
                .where(Membership.account_id == account_id)
                .options(selectinload(Membership.user))
            )
        ).scalars().all()
    )
    results = []
    for member in members:
        open_count = int(
            (await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == account_id,
                    Conversation.assigned_membership_id == member.id,
                    Conversation.status == ConversationStatus.OPEN,
                    Conversation.deleted_at.is_(None),
                )
            ))
            or 0
        )
        closed = int(
            (await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == account_id,
                    Conversation.assigned_membership_id == member.id,
                    Conversation.status == ConversationStatus.CLOSED,
                    Conversation.closed_at >= since,
                )
            ))
            or 0
        )
        assigned_conversations = list(
            (
                await db.execute(
                    select(Conversation).where(
                        Conversation.account_id == account_id,
                        Conversation.assigned_membership_id == member.id,
                        Conversation.created_at >= since,
                        Conversation.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
        )
        with_first = [c for c in assigned_conversations if c.first_response_at]
        first_response_avg = None
        if with_first:
            deltas = [
                (c.first_response_at - c.created_at).total_seconds() / 60
                for c in with_first
                if c.first_response_at
            ]
            first_response_avg = round(sum(deltas) / len(deltas), 1) if deltas else None
        sla_compliant = 0
        if with_first:
            sla_compliant = sum(
                1
                for c in with_first
                if c.first_response_at
                and (c.first_response_at - c.created_at).total_seconds() / 60 <= SLA_FIRST_RESPONSE_MINUTES
            )
        sla_compliance_pct = round(sla_compliant / len(with_first) * 100, 1) if with_first else None

        ratings = list(
            (
                await db.execute(
                    select(ConversationRating)
                    .join(Conversation, Conversation.id == ConversationRating.conversation_id)
                    .where(
                        Conversation.account_id == account_id,
                        Conversation.assigned_membership_id == member.id,
                        ConversationRating.created_at >= since,
                    )
                )
            ).scalars().all()
        )
        csat_avg = round(sum(r.score for r in ratings) / len(ratings), 2) if ratings else None

        deals_won = int(
            (await db.scalar(
                select(func.count(Deal.id)).where(
                    Deal.account_id == account_id,
                    Deal.assigned_membership_id == member.id,
                    Deal.stage == "won",
                    Deal.updated_at >= since,
                )
            ))
            or 0
        )

        results.append({
            "membership_id": str(member.id),
            "user_name": member.user.full_name if member.user else "—",
            "role": member.role.value,
            "open_conversations": open_count,
            "closed_conversations": closed,
            "first_response_avg_minutes": first_response_avg,
            "sla_compliance_pct": sla_compliance_pct,
            "csat_average": csat_avg,
            "csat_count": len(ratings),
            "deals_won": deals_won,
        })
    results.sort(key=lambda item: (-item["closed_conversations"], item["user_name"]))
    return results


async def sla_metrics(db: AsyncSession, *, account_id: UUID, days: int = 7) -> dict:
    since, _, _ = _period_bounds(days)
    conversations = list(
        (
            await db.execute(
                select(Conversation).where(
                    Conversation.account_id == account_id,
                    Conversation.created_at >= since,
                    Conversation.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    )
    with_first_response = [c for c in conversations if c.first_response_at]
    avg_first_response_minutes = None
    sla_compliance_pct = None
    if with_first_response:
        deltas = [
            (c.first_response_at - c.created_at).total_seconds() / 60
            for c in with_first_response
            if c.first_response_at
        ]
        avg_first_response_minutes = round(sum(deltas) / len(deltas), 1) if deltas else None
        compliant = sum(1 for d in deltas if d <= SLA_FIRST_RESPONSE_MINUTES)
        sla_compliance_pct = round(compliant / len(deltas) * 100, 1) if deltas else None
    closed = [c for c in conversations if c.closed_at]
    avg_resolution_minutes = None
    if closed:
        deltas = [(c.closed_at - c.created_at).total_seconds() / 60 for c in closed if c.closed_at]
        avg_resolution_minutes = round(sum(deltas) / len(deltas), 1) if deltas else None
    breaches = sum(
        1
        for c in conversations
        if c.status == ConversationStatus.OPEN
        and c.last_message_at
        and (datetime.now(UTC) - c.last_message_at).total_seconds() / 60 > SLA_FIRST_RESPONSE_MINUTES
    )
    return {
        "period_days": days,
        "total_conversations": len(conversations),
        "first_response_avg_minutes": avg_first_response_minutes,
        "resolution_avg_minutes": avg_resolution_minutes,
        "sla_compliance_pct": sla_compliance_pct,
        "sla_breaches_open": breaches,
        "sla_target_first_response_minutes": SLA_FIRST_RESPONSE_MINUTES,
        "sla_target_resolution_minutes": SLA_RESOLUTION_MINUTES,
    }


async def live_dashboard(db: AsyncSession, *, account_id: UUID) -> dict:
    open_count = int(
        (await db.scalar(
            select(func.count(Conversation.id)).where(
                Conversation.account_id == account_id,
                Conversation.status == ConversationStatus.OPEN,
                Conversation.deleted_at.is_(None),
            )
        ))
        or 0
    )
    waiting_team = int(
        (await db.scalar(
            select(func.count(Conversation.id)).where(
                Conversation.account_id == account_id,
                Conversation.status == ConversationStatus.OPEN,
                Conversation.deleted_at.is_(None),
                Conversation.last_message_at.is_not(None),
            )
        ))
        or 0
    )
    start_of_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    messages_today = int(
        (await db.scalar(
            select(func.count(Message.id))
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.account_id == account_id, Message.created_at >= start_of_day)
        ))
        or 0
    )
    inbound_today = int(
        (await db.scalar(
            select(func.count(Message.id)).where(
                Message.account_id == account_id,
                Message.direction == MessageDirection.INBOUND,
                Message.created_at >= start_of_day,
            )
        ))
        or 0
    )
    outbound_today = int(
        (await db.scalar(
            select(func.count(Message.id)).where(
                Message.account_id == account_id,
                Message.direction == MessageDirection.OUTBOUND,
                Message.created_at >= start_of_day,
            )
        ))
        or 0
    )
    return {
        "open_conversations": open_count,
        "waiting_team_reply": waiting_team,
        "messages_today": messages_today,
        "inbound_today": inbound_today,
        "outbound_today": outbound_today,
        "timestamp": datetime.now(UTC).isoformat(),
    }


async def analytics_overview(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since, prev_since, now = _period_bounds(days)

    async def count_messages(start: datetime, end: datetime, direction: MessageDirection | None = None) -> int:
        query = select(func.count(Message.id)).where(
            Message.account_id == account_id,
            Message.created_at >= start,
            Message.created_at < end,
        )
        if direction is not None:
            query = query.where(Message.direction == direction)
        return int((await db.scalar(query)) or 0)

    async def count_conversations(start: datetime, end: datetime) -> int:
        return int(
            (await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == account_id,
                    Conversation.created_at >= start,
                    Conversation.created_at < end,
                    Conversation.deleted_at.is_(None),
                )
            ))
            or 0
        )

    async def count_new_contacts(start: datetime, end: datetime) -> int:
        return int(
            (await db.scalar(
                select(func.count(Contact.id)).where(
                    Contact.account_id == account_id,
                    Contact.created_at >= start,
                    Contact.created_at < end,
                    Contact.deleted_at.is_(None),
                )
            ))
            or 0
        )

    async def count_deals_won(start: datetime, end: datetime) -> float:
        rows = list(
            (
                await db.execute(
                    select(Deal).where(
                        Deal.account_id == account_id,
                        Deal.stage == "won",
                        Deal.updated_at >= start,
                        Deal.updated_at < end,
                    )
                )
            ).scalars().all()
        )
        return round(sum(float(d.amount or 0) for d in rows), 3)

    current = {
        "messages_inbound": await count_messages(since, now, MessageDirection.INBOUND),
        "messages_outbound": await count_messages(since, now, MessageDirection.OUTBOUND),
        "conversations": await count_conversations(since, now),
        "new_contacts": await count_new_contacts(since, now),
        "revenue_won": await count_deals_won(since, now),
    }
    previous = {
        "messages_inbound": await count_messages(prev_since, since, MessageDirection.INBOUND),
        "messages_outbound": await count_messages(prev_since, since, MessageDirection.OUTBOUND),
        "conversations": await count_conversations(prev_since, since),
        "new_contacts": await count_new_contacts(prev_since, since),
        "revenue_won": await count_deals_won(prev_since, since),
    }
    changes = {key: _pct_change(current[key], previous[key]) for key in current}
    sla = await sla_metrics(db, account_id=account_id, days=days)
    from app.services.csat import csat_metrics

    csat = await csat_metrics(db, account_id=account_id, days=days)
    live = await live_dashboard(db, account_id=account_id)
    return {
        "period_days": days,
        "current": current,
        "previous": previous,
        "changes_pct": changes,
        "sla": sla,
        "csat": csat,
        "live": live,
    }


async def message_time_series(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since, _, now = _period_bounds(days)
    rows = list(
        (
            await db.execute(
                select(
                    func.date(Message.created_at).label("day"),
                    Message.direction,
                    func.count(Message.id).label("count"),
                )
                .where(Message.account_id == account_id, Message.created_at >= since)
                .group_by(func.date(Message.created_at), Message.direction)
                .order_by(func.date(Message.created_at))
            )
        ).all()
    )
    by_day: dict[str, dict[str, int]] = {}
    cursor = since.date()
    end = now.date()
    while cursor <= end:
        by_day[cursor.isoformat()] = {"inbound": 0, "outbound": 0}
        cursor += timedelta(days=1)
    for row in rows:
        day_key = row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day)
        if day_key not in by_day:
            by_day[day_key] = {"inbound": 0, "outbound": 0}
        direction = row.direction.value if hasattr(row.direction, "value") else str(row.direction)
        if direction == MessageDirection.INBOUND.value:
            by_day[day_key]["inbound"] = int(row.count)
        else:
            by_day[day_key]["outbound"] = int(row.count)
    series = [{"date": day, **counts} for day, counts in sorted(by_day.items())]
    return {"period_days": days, "series": series}


async def activity_heatmap(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since, _, _ = _period_bounds(days)
    rows = list(
        (
            await db.execute(
                select(
                    extract("dow", Message.created_at).label("dow"),
                    extract("hour", Message.created_at).label("hour"),
                    func.count(Message.id).label("count"),
                )
                .where(Message.account_id == account_id, Message.created_at >= since)
                .group_by(extract("dow", Message.created_at), extract("hour", Message.created_at))
            )
        ).all()
    )
    matrix = [[0 for _ in range(24)] for _ in range(7)]
    peak = 0
    for row in rows:
        dow = int(row.dow)
        hour = int(row.hour)
        count = int(row.count)
        matrix[dow][hour] = count
        peak = max(peak, count)
    return {"period_days": days, "matrix": matrix, "peak": peak}


async def customer_funnel(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since, _, _ = _period_bounds(days)
    total_contacts = int(
        (await db.scalar(
            select(func.count(Contact.id)).where(
                Contact.account_id == account_id, Contact.deleted_at.is_(None)
            )
        ))
        or 0
    )
    new_contacts = int(
        (await db.scalar(
            select(func.count(Contact.id)).where(
                Contact.account_id == account_id,
                Contact.deleted_at.is_(None),
                Contact.created_at >= since,
            )
        ))
        or 0
    )
    with_conversation = int(
        (await db.scalar(
            select(func.count(func.distinct(Conversation.contact_id))).where(
                Conversation.account_id == account_id,
                Conversation.deleted_at.is_(None),
                Conversation.created_at >= since,
            )
        ))
        or 0
    )
    two_way_rows = list(
        (
            await db.execute(
                select(Conversation.contact_id)
                .join(Message, Message.conversation_id == Conversation.id)
                .where(
                    Conversation.account_id == account_id,
                    Conversation.created_at >= since,
                    Conversation.deleted_at.is_(None),
                )
                .group_by(Conversation.contact_id)
                .having(
                    func.sum(case((Message.direction == MessageDirection.INBOUND, 1), else_=0)) > 0,
                    func.sum(case((Message.direction == MessageDirection.OUTBOUND, 1), else_=0)) > 0,
                )
            )
        ).all()
    )
    two_way = len(two_way_rows)
    deals_created = int(
        (await db.scalar(
            select(func.count(Deal.id)).where(
                Deal.account_id == account_id, Deal.created_at >= since
            )
        ))
        or 0
    )
    deals_won = int(
        (await db.scalar(
            select(func.count(Deal.id)).where(
                Deal.account_id == account_id,
                Deal.stage == "won",
                Deal.updated_at >= since,
            )
        ))
        or 0
    )
    return {
        "period_days": days,
        "total_contacts": total_contacts,
        "new_contacts": new_contacts,
        "with_conversation": with_conversation,
        "two_way_engaged": two_way,
        "deals_created": deals_created,
        "deals_won": deals_won,
        "funnel": [
            {"stage": "contacts", "label": "عملاء", "count": total_contacts},
            {"stage": "new", "label": "جدد", "count": new_contacts},
            {"stage": "conversation", "label": "محادثة", "count": with_conversation},
            {"stage": "two_way", "label": "تجاوب ثنائي", "count": two_way},
            {"stage": "deal", "label": "صفقة", "count": deals_created},
            {"stage": "won", "label": "فوز", "count": deals_won},
        ],
    }


async def campaign_analytics(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since, _, _ = _period_bounds(days)
    campaigns = list(
        (
            await db.execute(
                select(Campaign).where(
                    Campaign.account_id == account_id, Campaign.created_at >= since
                )
            )
        ).scalars().all()
    )
    total_recipients = 0
    sent = delivered = read = failed = 0
    campaign_rows = []
    for campaign in campaigns:
        recipients = list(
            (
                await db.execute(
                    select(CampaignRecipient).where(CampaignRecipient.campaign_id == campaign.id)
                )
            ).scalars().all()
        )
        c_total = len(recipients)
        c_sent = sum(
            1
            for r in recipients
            if r.status
            in (
                CampaignRecipientStatus.SENT,
                CampaignRecipientStatus.DELIVERED,
                CampaignRecipientStatus.READ,
                CampaignRecipientStatus.FAILED,
            )
        )
        c_delivered = sum(
            1
            for r in recipients
            if r.status in (CampaignRecipientStatus.DELIVERED, CampaignRecipientStatus.READ)
        )
        c_read = sum(1 for r in recipients if r.status == CampaignRecipientStatus.READ)
        c_failed = sum(1 for r in recipients if r.status == CampaignRecipientStatus.FAILED)
        total_recipients += c_total
        sent += c_sent
        delivered += c_delivered
        read += c_read
        failed += c_failed
        delivery_rate = round(c_delivered / c_sent * 100, 1) if c_sent else None
        read_rate = round(c_read / c_delivered * 100, 1) if c_delivered else None
        campaign_rows.append({
            "id": str(campaign.id),
            "name": campaign.name,
            "status": campaign.status.value if hasattr(campaign.status, "value") else str(campaign.status),
            "recipients": c_total,
            "sent": c_sent,
            "delivered": c_delivered,
            "read": c_read,
            "failed": c_failed,
            "delivery_rate": delivery_rate,
            "read_rate": read_rate,
        })
    campaign_rows.sort(key=lambda item: (-(item["read_rate"] or 0), item["name"]))
    delivery_rate = round(delivered / sent * 100, 1) if sent else None
    read_rate = round(read / delivered * 100, 1) if delivered else None
    return {
        "period_days": days,
        "summary": {
            "campaigns": len(campaigns),
            "recipients": total_recipients,
            "sent": sent,
            "delivered": delivered,
            "read": read,
            "failed": failed,
            "delivery_rate": delivery_rate,
            "read_rate": read_rate,
        },
        "campaigns": campaign_rows[:20],
    }


async def revenue_analytics(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    since, prev_since, now = _period_bounds(days)
    deals = list(
        (await db.execute(select(Deal).where(Deal.account_id == account_id))).scalars().all()
    )
    open_deals = [d for d in deals if d.stage not in ("won", "lost")]
    won_period = [d for d in deals if d.stage == "won" and d.updated_at and d.updated_at >= since]
    won_prev = [
        d for d in deals
        if d.stage == "won" and d.updated_at and prev_since <= d.updated_at < since
    ]
    pipeline_value = round(sum(float(d.amount or 0) for d in open_deals), 3)
    won_value = round(sum(float(d.amount or 0) for d in won_period), 3)
    won_value_prev = round(sum(float(d.amount or 0) for d in won_prev), 3)
    by_stage = {stage: len([d for d in deals if d.stage == stage]) for stage in DEAL_STAGES}
    velocity_days = None
    won_with_dates = [
        d for d in won_period
        if d.created_at and d.updated_at
    ]
    if won_with_dates:
        deltas = [(d.updated_at - d.created_at).days for d in won_with_dates]
        velocity_days = round(sum(deltas) / len(deltas), 1)
    forecast = round(
        sum(float(d.amount or 0) * (d.probability or 0) / 100 for d in open_deals),
        3,
    )
    return {
        "period_days": days,
        "pipeline_value": pipeline_value,
        "won_value": won_value,
        "won_value_change_pct": _pct_change(won_value, won_value_prev),
        "open_deals": len(open_deals),
        "won_count": len(won_period),
        "velocity_days": velocity_days,
        "forecast": forecast,
        "by_stage": by_stage,
        "funnel": [{"stage": s, "count": by_stage.get(s, 0)} for s in DEAL_STAGES],
    }


async def analytics_insights(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    overview = await analytics_overview(db, account_id=account_id, days=days)
    sla = overview["sla"]
    csat = overview["csat"]
    campaigns = await campaign_analytics(db, account_id=account_id, days=days)
    revenue = await revenue_analytics(db, account_id=account_id, days=days)
    agents = await agent_performance(db, account_id=account_id, days=days)
    insights: list[dict] = []

    if sla.get("first_response_avg_minutes") and sla["first_response_avg_minutes"] > SLA_FIRST_RESPONSE_MINUTES:
        insights.append({
            "level": "warning",
            "code": "sla_slow",
            "title": "أول رد أبطأ من الهدف",
            "message": f"متوسط أول رد {sla['first_response_avg_minutes']} دقيقة (الهدف {SLA_FIRST_RESPONSE_MINUTES} د).",
            "action_path": "/inbox",
        })
    if sla.get("sla_breaches_open", 0) > 0:
        insights.append({
            "level": "critical",
            "code": "sla_breach",
            "title": "محادثات تجاوزت SLA",
            "message": f"{sla['sla_breaches_open']} محادثة مفتوحة تجاوزت وقت الرد المستهدف.",
            "action_path": "/inbox",
        })
    if csat.get("average_score") and csat["average_score"] < 3.5:
        insights.append({
            "level": "warning",
            "code": "csat_low",
            "title": "رضا العملاء منخفض",
            "message": f"متوسط CSAT {csat['average_score']} — راجع جودة الردود.",
            "action_path": "/analytics?tab=team",
        })
    if campaigns["summary"].get("delivery_rate") is not None and campaigns["summary"]["delivery_rate"] < 85:
        insights.append({
            "level": "warning",
            "code": "campaign_delivery",
            "title": "معدل تسليم الحملات منخفض",
            "message": f"معدل التسليم {campaigns['summary']['delivery_rate']}% — تحقق من القوالب والأرقام.",
            "action_path": "/campaigns",
        })
    change = overview["changes_pct"].get("revenue_won")
    if change is not None and change > 10:
        insights.append({
            "level": "success",
            "code": "revenue_up",
            "title": "إيرادات في ارتفاع",
            "message": f"قيمة الصفقات الرابحة ارتفعت {change}% مقارنة بالفترة السابقة.",
            "action_path": "/crm",
        })
    elif change is not None and change < -10:
        insights.append({
            "level": "warning",
            "code": "revenue_down",
            "title": "إيرادات في انخفاض",
            "message": f"قيمة الصفقات الرابحة انخفضت {abs(change)}% — راجع pipeline.",
            "action_path": "/crm",
        })

    slow_agents = [
        a for a in agents
        if a.get("first_response_avg_minutes") and a["first_response_avg_minutes"] > SLA_FIRST_RESPONSE_MINUTES * 1.5
    ]
    if slow_agents:
        names = "، ".join(a["user_name"] for a in slow_agents[:3])
        insights.append({
            "level": "info",
            "code": "agent_slow",
            "title": "موظفون يحتاجون دعم",
            "message": f"أبطأ رد: {names}.",
            "action_path": "/analytics?tab=team",
        })

    top_agent = next((a for a in agents if a.get("csat_average")), None)
    if top_agent and top_agent.get("csat_average", 0) >= 4.5:
        insights.append({
            "level": "success",
            "code": "top_agent",
            "title": "أفضل أداء",
            "message": f"{top_agent['user_name']} CSAT {top_agent['csat_average']} — أعلى تقييم.",
            "action_path": "/analytics?tab=team",
        })

    if not insights:
        insights.append({
            "level": "success",
            "code": "all_good",
            "title": "الأداء مستقر",
            "message": "لا توجد تنبيهات حرجة في هذه الفترة.",
            "action_path": None,
        })

    return {"period_days": days, "insights": insights}


async def dashboard_analytics(db: AsyncSession, *, account_id: UUID, days: int = 30) -> dict:
    """Account-wide executive dashboard aggregating overview, channels, MAC, and campaigns."""
    from app.services.channels import get_channel_stats
    from app.services.mac_tracking import current_cycle_month

    overview = await analytics_overview(db, account_id=account_id, days=days)
    time_series = await message_time_series(db, account_id=account_id, days=days)
    campaigns = await campaign_analytics(db, account_id=account_id, days=days)
    channel_stats = await get_channel_stats(db, account_id)

    since, _, now = _period_bounds(days)
    active_channels = sum(
        1 for c in channel_stats
        if str(c.get("channel_status", "")).lower() == "active"
    )
    total_mac = sum(int(c.get("mac_count") or 0) for c in channel_stats)
    cycle = channel_stats[0].get("mac_cycle_month") if channel_stats else current_cycle_month()

    total_contacts = int(
        (await db.scalar(
            select(func.count(Contact.id)).where(
                Contact.account_id == account_id, Contact.deleted_at.is_(None)
            )
        ))
        or 0
    )

    channel_ids = [c["channel_id"] for c in channel_stats]
    channel_names = {str(c["channel_id"]): c["channel_name"] for c in channel_stats}
    channel_orgs = {str(c["channel_id"]): c.get("organization_name") for c in channel_stats}

    period_by_channel: dict[str, dict[str, int]] = {}
    if channel_ids:
        period_rows = list(
            (
                await db.execute(
                    select(
                        Message.channel_id,
                        Message.direction,
                        func.count(Message.id).label("count"),
                    )
                    .where(
                        Message.account_id == account_id,
                        Message.channel_id.in_(channel_ids),
                        Message.created_at >= since,
                    )
                    .group_by(Message.channel_id, Message.direction)
                )
            ).all()
        )
        for row in period_rows:
            cid = str(row.channel_id)
            if cid not in period_by_channel:
                period_by_channel[cid] = {"inbound": 0, "outbound": 0, "total": 0}
            direction = row.direction.value if hasattr(row.direction, "value") else str(row.direction)
            count = int(row.count)
            if direction == MessageDirection.INBOUND.value:
                period_by_channel[cid]["inbound"] = count
            else:
                period_by_channel[cid]["outbound"] = count
            period_by_channel[cid]["total"] = period_by_channel[cid]["inbound"] + period_by_channel[cid]["outbound"]

    channel_comparison = []
    for cid, counts in period_by_channel.items():
        stat = next((c for c in channel_stats if str(c["channel_id"]) == cid), None)
        channel_comparison.append({
            "channel_id": cid,
            "channel_name": channel_names.get(cid, "—"),
            "organization_name": channel_orgs.get(cid),
            "inbound": counts["inbound"],
            "outbound": counts["outbound"],
            "total": counts["total"],
            "mac_count": int(stat.get("mac_count") or 0) if stat else 0,
            "quality_rating": stat.get("quality_rating") if stat else None,
        })
    channel_comparison.sort(key=lambda item: (-item["total"], item["channel_name"]))
    top_channels = channel_comparison[:10]

    mac_trend_rows = list(
        (
            await db.execute(
                select(
                    func.date_trunc("day", MonthlyActiveContact.first_activity_at).label("day"),
                    func.count(MonthlyActiveContact.id).label("count"),
                )
                .where(
                    MonthlyActiveContact.account_id == account_id,
                    MonthlyActiveContact.cycle_month == cycle,
                )
                .group_by("day")
                .order_by("day")
            )
        ).all()
    )
    mac_trend = [
        {
            "date": row.day.date().isoformat() if hasattr(row.day, "date") else str(row.day)[:10],
            "count": int(row.count),
        }
        for row in mac_trend_rows
    ]

    campaign_chart = [
        {"name": "مُسلّم", "value": campaigns["summary"].get("delivered") or 0},
        {"name": "مقروء", "value": campaigns["summary"].get("read") or 0},
        {"name": "فشل", "value": campaigns["summary"].get("failed") or 0},
    ]

    recent_rows = list(
        (
            await db.execute(
                select(Conversation, Contact, Channel)
                .join(Contact, Contact.id == Conversation.contact_id)
                .join(Channel, Channel.id == Conversation.channel_id)
                .where(
                    Conversation.account_id == account_id,
                    Conversation.deleted_at.is_(None),
                )
                .order_by(Conversation.last_message_at.desc().nullslast(), Conversation.updated_at.desc())
                .limit(10)
            )
        ).all()
    )
    recent_activity = []
    for conv, contact, channel in recent_rows:
        recent_activity.append({
            "conversation_id": str(conv.id),
            "contact_name": contact.display_name or contact.phone or "—",
            "channel_name": channel.name,
            "status": conv.status.value if hasattr(conv.status, "value") else str(conv.status),
            "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
        })

    insights_data = await analytics_insights(db, account_id=account_id, days=days)

    return {
        "period_days": days,
        "summary": {
            "messages_inbound": overview["current"]["messages_inbound"],
            "messages_outbound": overview["current"]["messages_outbound"],
            "messages_total": overview["current"]["messages_inbound"] + overview["current"]["messages_outbound"],
            "active_channels": active_channels,
            "total_channels": len(channel_stats),
            "mac_total": total_mac,
            "mac_cycle_month": cycle,
            "campaigns_sent": campaigns["summary"].get("sent") or 0,
            "campaigns_count": campaigns["summary"].get("campaigns") or 0,
            "total_contacts": total_contacts,
            "new_contacts": overview["current"]["new_contacts"],
            "open_conversations": overview["live"]["open_conversations"],
            "waiting_team_reply": overview["live"]["waiting_team_reply"],
            "first_response_avg_minutes": overview["sla"].get("first_response_avg_minutes"),
            "sla_compliance_pct": overview["sla"].get("sla_compliance_pct"),
            "csat_average": overview["csat"].get("average_score"),
        },
        "changes_pct": overview["changes_pct"],
        "message_series": time_series["series"],
        "channel_comparison": channel_comparison[:8],
        "mac_trend": mac_trend,
        "campaign_summary": campaigns["summary"],
        "campaign_chart": campaign_chart,
        "top_channels": top_channels,
        "recent_activity": recent_activity,
        "insights_preview": (insights_data.get("insights") or [])[:3],
    }

