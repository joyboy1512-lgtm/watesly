from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, membership_has_permission
from app.models.campaign import Campaign, CampaignStatus
from app.models.channel import Channel
from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.message import Message, MessageDirection
from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus
from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
from app.services.analytics import sla_metrics
from app.services.campaigns import get_campaign_report
from app.services.conversation_attention import (
    count_waiting_reply,
    latest_message_id_subquery,
    waiting_reply_predicates,
)
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
    db: AsyncSession,
    *,
    account_id: UUID,
    limit: int = 5,
    assigned_membership_id: UUID | None = None,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
) -> list[dict]:
    now = datetime.now(UTC)
    latest_message_id = latest_message_id_subquery()
    query = (
        select(Conversation, Contact, Message)
        .join(Contact, Contact.id == Conversation.contact_id)
        .join(Message, Message.id == latest_message_id)
        .where(
            Conversation.account_id == account_id,
            *waiting_reply_predicates(now=now),
            Contact.deleted_at.is_(None),
        )
        .order_by(desc(Conversation.last_message_at))
        .limit(limit)
    )
    if assigned_membership_id is not None:
        query = query.where(Conversation.assigned_membership_id == assigned_membership_id)
    if organization_id is not None:
        query = query.where(Conversation.organization_id == organization_id)
    if channel_id is not None:
        query = query.where(Conversation.channel_id == channel_id)
    rows = list((await db.execute(query)).all())
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
                "action_path": "/inbox?filter=waiting",
            }
        )

    return alerts


def _attention_audience(role: MembershipRole) -> str:
    if role in {MembershipRole.OWNER, MembershipRole.ADMIN}:
        return "owner"
    if role in {MembershipRole.MANAGER, MembershipRole.BRANCH_ADMIN}:
        return "supervisor"
    return "employee"


def _attention_inbox_href(
    *,
    mine_only: bool,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
    filter: str = "waiting",
    needs_reply: bool = True,
    extra: str = "",
) -> str:
    parts = [f"filter={filter}"]
    if mine_only:
        parts.append("inbox_scope=mine")
    if needs_reply:
        parts.append("needs_reply=1")
    if organization_id is not None:
        # Inbox reads branch from workspace store; keep query for deep-link parity.
        parts.append(f"organization_id={organization_id}")
    if channel_id is not None:
        parts.append(f"channel_id={channel_id}")
    if extra:
        parts.append(extra.lstrip("&"))
    return "/inbox?" + "&".join(parts)


async def get_dashboard_attention(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
) -> dict:
    """Role-aware «what needs my attention today?» payload."""
    now = datetime.now(UTC)
    role = membership.role
    audience = _attention_audience(role)
    mine_only = audience == "employee"
    assigned_id = membership.id if mine_only else None

    waiting_count = await count_waiting_reply(
        db,
        account_id=account_id,
        assigned_membership_id=assigned_id,
        organization_id=organization_id,
        channel_id=channel_id,
    )
    waiting_href = _attention_inbox_href(
        mine_only=mine_only,
        organization_id=organization_id,
        channel_id=channel_id,
    )
    waiting_preview = await _waiting_conversations(
        db,
        account_id=account_id,
        limit=5,
        assigned_membership_id=assigned_id,
        organization_id=organization_id,
        channel_id=channel_id,
    )

    cards: list[dict] = [
        {
            "id": "waiting_reply",
            "label": "تنتظر ردي" if mine_only else "تنتظر الرد",
            "count": waiting_count,
            "href": waiting_href,
            "status": "ok",
            "hint": "آخر رسالة واردة من العميل · مفتوحة/قيد الانتظار · غير مؤرشفة",
            "meta": "اليوم · نفس تعريف صندوق الوارد",
        }
    ]

    if audience == "employee":
        open_mine_q = select(func.count(Conversation.id)).where(
            Conversation.account_id == account_id,
            Conversation.deleted_at.is_(None),
            Conversation.archived_at.is_(None),
            Conversation.status.in_(
                [ConversationStatus.OPEN, ConversationStatus.PENDING]
            ),
            Conversation.assigned_membership_id == membership.id,
        )
        if organization_id is not None:
            open_mine_q = open_mine_q.where(Conversation.organization_id == organization_id)
        if channel_id is not None:
            open_mine_q = open_mine_q.where(Conversation.channel_id == channel_id)
        open_mine = int((await db.scalar(open_mine_q)) or 0)
        my_open_href = _attention_inbox_href(
            mine_only=True,
            organization_id=organization_id,
            channel_id=channel_id,
            filter="engaged",
            needs_reply=False,
        )
        cards.append(
            {
                "id": "my_open",
                "label": "محادثاتي المفتوحة",
                "count": open_mine,
                "href": my_open_href,
                "status": "ok",
                "meta": "معيّنة لي",
            }
        )
        primary = {
            "title": "ارِد على من ينتظرك" if waiting_count else "لا توجد محادثات بانتظارك",
            "detail": (
                f"{waiting_count} محادثة تنتظر ردّك الآن"
                if waiting_count
                else "يمكنك متابعة محادثاتك المفتوحة من صندوق الوارد"
            ),
            "href": waiting_href
            if waiting_count
            else _attention_inbox_href(
                mine_only=True,
                organization_id=organization_id,
                channel_id=channel_id,
                filter="engaged",
                needs_reply=False,
            ),
            "count": waiting_count,
        }
    elif audience == "supervisor":
        from app.services.inbox_tools import supervisor_summary

        supervisor = await supervisor_summary(db, account_id=account_id)
        supervisor_waiting_href = waiting_href
        snoozed_href = _attention_inbox_href(
            mine_only=False,
            organization_id=organization_id,
            channel_id=channel_id,
            filter="snoozed",
            needs_reply=False,
        )
        cards.extend(
            [
                {
                    "id": "sla_breached",
                    "label": "تجاوز SLA",
                    "count": int(supervisor.get("sla_breached_conversations") or 0),
                    "href": supervisor_waiting_href,
                    "status": "ok",
                    "hint": "محادثات معلّمة بتجاوز اتفاقية الخدمة",
                    "meta": "عمليات الفريق",
                },
                {
                    "id": "unresolved_1h",
                    "label": "بدون حل +1 ساعة",
                    "count": int(supervisor.get("unresolved_over_1h") or 0),
                    "href": supervisor_waiting_href,
                    "status": "ok",
                    "meta": "وارد متأخر",
                },
                {
                    "id": "snoozed",
                    "label": "مؤجلة",
                    "count": int(supervisor.get("snoozed_conversations") or 0),
                    "href": snoozed_href,
                    "status": "ok",
                },
                {
                    "id": "team_load",
                    "label": "حمل الفريق",
                    "count": len(supervisor.get("agents") or []),
                    "href": "/assignments",
                    "status": "ok",
                    "meta": "موظفين لديهم محادثات مفتوحة",
                },
                {
                    "id": "channels",
                    "label": "قنوات نشطة",
                    "count": len(supervisor.get("by_channel") or []),
                    "href": "/channels",
                    "status": "ok",
                    "meta": "حسب نوع القناة",
                },
            ]
        )
        top = waiting_count or int(supervisor.get("sla_breached_conversations") or 0)
        primary = {
            "title": "راجع المتأخرات الآن" if top else "الفريق تحت السيطرة",
            "detail": (
                f"{waiting_count} تنتظر الرد · {supervisor.get('sla_breached_conversations') or 0} تجاوز SLA"
            ),
            "href": waiting_href if waiting_count else "/assignments",
            "count": waiting_count,
        }
    else:
        # Owner / admin — campaigns, CRM, usage when permitted
        if membership_has_permission(membership, Permission.CAMPAIGNS_VIEW):
            since = now - timedelta(days=7)
            campaign_issues = int(
                (
                    await db.scalar(
                        select(func.count(Campaign.id)).where(
                            Campaign.account_id == account_id,
                            Campaign.status.in_(
                                [
                                    CampaignStatus.FAILED,
                                    CampaignStatus.COMPLETED_WITH_ERRORS,
                                    CampaignStatus.RUNNING,
                                ]
                            ),
                            Campaign.created_at >= since,
                        )
                    )
                )
                or 0
            )
            cards.append(
                {
                    "id": "campaigns",
                    "label": "حملات تحتاج متابعة",
                    "count": campaign_issues,
                    "href": "/campaigns",
                    "status": "ok",
                    "meta": "آخر 7 أيام · فشل / بأخطاء / قيد الإرسال",
                }
            )
        else:
            cards.append(
                {
                    "id": "campaigns",
                    "label": "حملات تحتاج متابعة",
                    "count": None,
                    "href": "/campaigns",
                    "status": "unavailable",
                    "hint": "غير متاح — صلاحية campaigns.view مطلوبة",
                }
            )

        if membership_has_permission(membership, Permission.CONTACTS_VIEW):
            from app.services.crm import crm_stats

            stats = await crm_stats(db, account_id=account_id, membership=membership)
            cards.append(
                {
                    "id": "deals_open",
                    "label": "صفقات مفتوحة",
                    "count": int(stats.get("open") or 0),
                    "href": "/crm",
                    "status": "ok",
                    "meta": f"قيمة pipeline: {stats.get('pipeline_value') or 0}",
                }
            )
        else:
            cards.append(
                {
                    "id": "deals_open",
                    "label": "صفقات مفتوحة",
                    "count": None,
                    "href": "/crm",
                    "status": "unavailable",
                    "hint": "غير متاح — صلاحية contacts.view مطلوبة",
                }
            )

        if membership_has_permission(membership, Permission.BILLING_VIEW):
            cards.append(
                {
                    "id": "usage",
                    "label": "الاستخدام والفوترة",
                    "count": None,
                    "href": "/billing",
                    "status": "ok",
                    "meta": "الخطة · MAC · القنوات",
                }
            )
        else:
            cards.append(
                {
                    "id": "usage",
                    "label": "الاستخدام والفوترة",
                    "count": None,
                    "href": "/billing",
                    "status": "unavailable",
                    "hint": "غير متاح — صلاحية billing.view مطلوبة",
                }
            )

        primary = {
            "title": "أولوية اليوم: الردود والحملات" if waiting_count else "راجع النتائج والاستخدام",
            "detail": (
                f"{waiting_count} محادثة تنتظر الرد — ثم راجع الحملات والصفقات"
                if waiting_count
                else "لا محادثات بانتظار الرد — راجع نتائج الحملات والصفقات"
            ),
            "href": waiting_href if waiting_count else "/campaigns",
            "count": waiting_count,
        }

    return {
        "role": role.value if hasattr(role, "value") else str(role),
        "audience": audience,
        "updated_at": now,
        "question": "ماذا يتطلب انتباهي اليوم؟",
        "primary_action": primary,
        "cards": cards,
        "waiting_reply_count": waiting_count,
        "waiting_preview": waiting_preview,
    }
