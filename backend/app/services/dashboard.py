from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.channel import Channel
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.membership import Membership, MembershipStatus
from app.models.message import Message, MessageDirection
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.services.analytics import sla_metrics
from app.services.campaigns import get_campaign_report
from app.services.csat import csat_metrics


async def get_dashboard_summary(db: AsyncSession, account_id: UUID) -> dict:
    start_of_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    now = datetime.now(UTC)

    async def count(query):
        value = await db.scalar(query)
        return int(value or 0)

    open_count = await count(
        select(func.count(Conversation.id)).where(
            Conversation.account_id == account_id,
            Conversation.status == ConversationStatus.OPEN,
        )
    )
    pending_count = await count(
        select(func.count(Conversation.id)).where(
            Conversation.account_id == account_id,
            Conversation.status == ConversationStatus.PENDING,
        )
    )
    closed_count = await count(
        select(func.count(Conversation.id)).where(
            Conversation.account_id == account_id,
            Conversation.status == ConversationStatus.CLOSED,
        )
    )
    total_count = await count(
        select(func.count(Conversation.id)).where(Conversation.account_id == account_id)
    )
    total_contacts = await count(
        select(func.count(Contact.id)).where(Contact.account_id == account_id)
    )
    active_users = await count(
        select(func.count(Membership.id)).where(
            Membership.account_id == account_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    total_channels = await count(
        select(func.count(Channel.id)).where(Channel.account_id == account_id)
    )
    sent_today = await count(
        select(func.count(Message.id)).where(
            Message.account_id == account_id,
            Message.direction == MessageDirection.OUTBOUND,
            Message.created_at >= start_of_day,
        )
    )
    received_today = await count(
        select(func.count(Message.id)).where(
            Message.account_id == account_id,
            Message.direction == MessageDirection.INBOUND,
            Message.created_at >= start_of_day,
        )
    )

    csat = await csat_metrics(db, account_id=account_id, days=30)
    sla = await sla_metrics(db, account_id=account_id)
    waiting_conversations = await _waiting_conversations(db, account_id=account_id, limit=5)
    latest_campaign = await _latest_campaign(db, account_id=account_id)
    alerts = await _dashboard_alerts(
        db,
        account_id=account_id,
        waiting_count=len(waiting_conversations),
    )

    return {
        "open_conversations": open_count,
        "pending_conversations": pending_count,
        "closed_conversations": closed_count,
        "total_conversations": total_count,
        "total_contacts": total_contacts,
        "active_users": active_users,
        "total_channels": total_channels,
        "sent_messages_today": sent_today,
        "received_messages_today": received_today,
        "csat_average": csat.get("average_score"),
        "csat_total_ratings": int(csat.get("total_ratings") or 0),
        "csat_promoters_pct": csat.get("promoters_pct"),
        "first_response_avg_minutes": sla.get("first_response_avg_minutes"),
        "waiting_conversations": waiting_conversations,
        "latest_campaign": latest_campaign,
        "alerts": alerts,
    }


async def _waiting_conversations(
    db: AsyncSession, *, account_id: UUID, limit: int = 5
) -> list[dict]:
    now = datetime.now(UTC)
    latest_message_id = (
        select(Message.id)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
        .correlate(Conversation)
        .scalar_subquery()
    )
    rows = list(
        (
            await db.execute(
                select(Conversation, Contact, Message)
                .join(Contact, Contact.id == Conversation.contact_id)
                .join(Message, Message.id == latest_message_id)
                .where(
                    Conversation.account_id == account_id,
                    Conversation.deleted_at.is_(None),
                    Conversation.archived_at.is_(None),
                    Conversation.status.in_(
                        [ConversationStatus.OPEN, ConversationStatus.PENDING]
                    ),
                    Message.direction == MessageDirection.INBOUND,
                    (Conversation.snoozed_until.is_(None))
                    | (Conversation.snoozed_until <= now),
                    Contact.deleted_at.is_(None),
                )
                .order_by(desc(Conversation.last_message_at))
                .limit(limit)
            )
        ).all()
    )
    items: list[dict] = []
    for conversation, contact, message in rows:
        waiting_minutes = None
        if conversation.last_message_at:
            waiting_minutes = max(
                0,
                int((now - conversation.last_message_at).total_seconds() // 60),
            )
        items.append(
            {
                "id": conversation.id,
                "contact_name": contact.display_name,
                "contact_address": contact.external_address,
                "last_message_text": message.text_body,
                "last_message_at": conversation.last_message_at,
                "waiting_minutes": waiting_minutes,
            }
        )
    return items


async def _latest_campaign(db: AsyncSession, *, account_id: UUID) -> dict | None:
    campaign = (
        await db.execute(
            select(Campaign)
            .where(Campaign.account_id == account_id)
            .order_by(desc(Campaign.created_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    if campaign is None:
        return None
    report = await get_campaign_report(
        db, account_id=account_id, campaign_id=campaign.id
    )
    status = campaign.status.value if hasattr(campaign.status, "value") else str(campaign.status)
    return {
        "id": campaign.id,
        "name": campaign.name,
        "status": status,
        "completed_at": campaign.completed_at,
        "total": int(report.get("total") or 0),
        "sent": int(report.get("sent") or 0),
        "delivered": int(report.get("delivered") or 0),
        "read": int(report.get("read") or 0),
        "failed": int(report.get("failed") or 0),
    }


async def _dashboard_alerts(
    db: AsyncSession,
    *,
    account_id: UUID,
    waiting_count: int,
) -> list[dict]:
    alerts: list[dict] = []

    wa_accounts = list(
        (
            await db.execute(
                select(WhatsAppAccount).where(WhatsAppAccount.account_id == account_id)
            )
        ).scalars().all()
    )
    if not wa_accounts:
        alerts.append(
            {
                "level": "error",
                "code": "whatsapp_missing",
                "message": "لم يتم ربط حساب WhatsApp بعد — ابدأ من صفحة الربط.",
                "action_path": "/whatsapp-connect",
            }
        )
    else:
        active = [item for item in wa_accounts if item.status == WhatsAppAccountStatus.ACTIVE]
        if not active:
            alerts.append(
                {
                    "level": "warning",
                    "code": "whatsapp_disconnected",
                    "message": "حساب WhatsApp غير نشط — تحقق من الاتصال وصحة الحساب.",
                    "action_path": "/whatsapp-connect",
                }
            )
        for item in wa_accounts:
            rating = (item.quality_rating or "").upper()
            if rating in {"RED", "YELLOW"}:
                alerts.append(
                    {
                        "level": "warning",
                        "code": "whatsapp_quality",
                        "message": f"جودة الرقم {item.display_phone_number}: {rating} — راجع حدود الإرسال.",
                        "action_path": "/whatsapp-connect",
                    }
                )
                break

    pending_templates = int(
        (
            await db.scalar(
                select(func.count(WhatsAppTemplate.id)).where(
                    WhatsAppTemplate.account_id == account_id,
                    WhatsAppTemplate.status == TemplateStatus.PENDING,
                )
            )
        )
        or 0
    )
    if pending_templates > 0:
        alerts.append(
            {
                "level": "info",
                "code": "templates_pending",
                "message": f"{pending_templates} قالب بانتظار موافقة Meta.",
                "action_path": "/templates",
            }
        )

    draft_templates = int(
        (
            await db.scalar(
                select(func.count(WhatsAppTemplate.id)).where(
                    WhatsAppTemplate.account_id == account_id,
                    WhatsAppTemplate.status == TemplateStatus.DRAFT,
                )
            )
        )
        or 0
    )
    if draft_templates > 0:
        alerts.append(
            {
                "level": "info",
                "code": "templates_draft",
                "message": f"{draft_templates} قالب مسودة — أكمله وارسله للموافقة.",
                "action_path": "/templates",
            }
        )

    if waiting_count > 0:
        alerts.append(
            {
                "level": "warning",
                "code": "conversations_waiting",
                "message": f"{waiting_count} محادثة تنتظر رد فريقك الآن.",
                "action_path": "/inbox",
            }
        )

    return alerts
