import csv
import io
import re
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.message import Message, MessageDirection
from app.models.organization import Organization
from app.models.quick_reply import QuickReply
from app.schemas.inbox_tools import (
    QuickReplyCreateRequest,
    QuickReplyFromConversationRequest,
    QuickReplyUpdateRequest,
)

SHORTCUT_PATTERN = re.compile(r"^/[\w\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF_-]+$")

QUICK_REPLY_CATEGORIES = (
    "shipping",
    "pricing",
    "welcome",
    "closing",
    "support",
    "payment",
    "returns",
    "general",
)

STARTER_REPLIES = [
    {
        "shortcut": "/ترحيب",
        "title": "ترحيب بالعميل",
        "body": "مرحباً {{contact.name}}! 👋\nشكراً لتواصلك معنا. كيف يمكنني مساعدتك اليوم؟",
        "category": "welcome",
        "tags": "ترحيب,بداية",
        "sort_order": 1,
    },
    {
        "shortcut": "/شحن",
        "title": "معلومات الشحن",
        "body": "أهلاً {{contact.name}}،\nالشحن يستغرق 2-5 أيام عمل داخل المملكة.\nسيتم إرسال رقم التتبع فور شحن الطلب.",
        "category": "shipping",
        "tags": "شحن,توصيل,تتبع",
        "sort_order": 2,
    },
    {
        "shortcut": "/اسعار",
        "title": "الأسعار والعروض",
        "body": "مرحباً {{contact.name}}،\nيسعدنا مشاركتك أحدث الأسعار والعروض.\nما المنتج الذي تبحث عنه؟",
        "category": "pricing",
        "tags": "سعر,عرض,خصم",
        "sort_order": 3,
    },
    {
        "shortcut": "/دفع",
        "title": "طرق الدفع",
        "body": "طرق الدفع المتاحة:\n• تحويل بنكي\n• بطاقة مدى/ائتمان\n• الدفع عند الاستلام (حسب المنطقة)",
        "category": "payment",
        "tags": "دفع,تحويل,مدى",
        "sort_order": 4,
    },
    {
        "shortcut": "/اغلاق",
        "title": "إغلاق المحادثة",
        "body": "شكراً لك {{contact.name}} 🙏\nسعدنا بخدمتك. إذا احتجت أي شيء لاحقاً لا تتردد بالتواصل.",
        "category": "closing",
        "tags": "شكر,وداع,إغلاق",
        "sort_order": 5,
    },
]


def _normalize_tags(tags: str | None) -> str | None:
    if not tags:
        return None
    parts = [part.strip() for part in tags.split(",") if part.strip()]
    return ", ".join(parts) if parts else None


def _reply_row(item: QuickReply) -> dict:
    return {
        "id": str(item.id),
        "organization_id": str(item.organization_id),
        "channel_id": str(item.channel_id) if item.channel_id else None,
        "shortcut": item.shortcut,
        "title": item.title,
        "body": item.body,
        "category": item.category,
        "tags": item.tags,
        "tone_variant": item.tone_variant,
        "is_shared": item.is_shared,
        "is_active": item.is_active,
        "sort_order": item.sort_order,
        "usage_count": item.usage_count,
    }


async def _get_reply(db: AsyncSession, account_id: UUID, reply_id: UUID) -> QuickReply | None:
    item = await db.get(QuickReply, reply_id)
    if item is None or item.account_id != account_id:
        return None
    return item


async def list_quick_replies(
    db: AsyncSession,
    account_id: UUID,
    *,
    membership=None,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
    category: str | None = None,
    q: str | None = None,
    active_only: bool = True,
) -> list[QuickReply]:
    from app.services.membership_access import organization_scope_clauses

    query = select(QuickReply).where(QuickReply.account_id == account_id)
    if active_only:
        query = query.where(QuickReply.is_active.is_(True))
    if membership is not None:
        for clause in await organization_scope_clauses(
            db,
            account_id=account_id,
            membership=membership,
            organization_column=QuickReply.organization_id,
        ):
            query = query.where(clause)
        if organization_id is not None:
            query = query.where(QuickReply.organization_id == organization_id)
    elif organization_id:
        query = query.where(
            or_(QuickReply.organization_id == organization_id, QuickReply.is_shared.is_(True))
        )
    if channel_id:
        query = query.where(or_(QuickReply.channel_id.is_(None), QuickReply.channel_id == channel_id))
    if category:
        query = query.where(QuickReply.category == category)
    if q:
        term = f"%{q.strip()}%"
        query = query.where(
            or_(
                QuickReply.shortcut.ilike(term),
                QuickReply.title.ilike(term),
                QuickReply.body.ilike(term),
                QuickReply.tags.ilike(term),
            )
        )
    query = query.order_by(
        QuickReply.usage_count.desc(),
        QuickReply.sort_order.asc(),
        QuickReply.title.asc(),
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def list_quick_reply_categories(db: AsyncSession, account_id: UUID) -> list[str]:
    result = await db.execute(
        select(QuickReply.category)
        .where(QuickReply.account_id == account_id, QuickReply.is_active.is_(True))
        .distinct()
        .order_by(QuickReply.category.asc())
    )
    values = [row[0] for row in result.all() if row[0]]
    return sorted(set(values) | set(QUICK_REPLY_CATEGORIES))


async def create_quick_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    payload: QuickReplyCreateRequest,
    membership=None,
) -> QuickReply:
    from app.services.membership_access import ensure_membership_organization_access

    organization = await db.get(Organization, payload.organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    if membership is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=payload.organization_id,
        )
    data = payload.model_dump()
    data["tags"] = _normalize_tags(data.get("tags"))
    item = QuickReply(
        account_id=account_id,
        created_by_user_id=user_id,
        **data,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_quick_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    reply_id: UUID,
    payload: QuickReplyUpdateRequest,
    membership=None,
) -> QuickReply:
    from app.services.membership_access import ensure_membership_organization_access

    item = await _get_reply(db, account_id, reply_id)
    if item is None:
        raise ValueError("NOT_FOUND")
    if membership is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=item.organization_id,
        )
    updates = payload.model_dump(exclude_unset=True)
    if "organization_id" in updates:
        organization = await db.get(Organization, updates["organization_id"])
        if organization is None or organization.account_id != account_id:
            raise ValueError("INVALID_ORGANIZATION")
    if "tags" in updates:
        updates["tags"] = _normalize_tags(updates.get("tags"))
    for key, value in updates.items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def archive_quick_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    reply_id: UUID,
    membership=None,
) -> QuickReply:
    from app.services.membership_access import ensure_membership_organization_access

    item = await _get_reply(db, account_id, reply_id)
    if item is None:
        raise ValueError("NOT_FOUND")
    if membership is not None:
        await ensure_membership_organization_access(
            db,
            account_id=account_id,
            membership=membership,
            organization_id=item.organization_id,
        )
    item.is_active = False
    await db.commit()
    await db.refresh(item)
    return item


async def increment_quick_reply_usage(
    db: AsyncSession, *, account_id: UUID, reply_id: UUID
) -> QuickReply:
    item = await _get_reply(db, account_id, reply_id)
    if item is None:
        raise ValueError("NOT_FOUND")
    item.usage_count = (item.usage_count or 0) + 1
    await db.commit()
    await db.refresh(item)
    return item


def _score_reply(item: QuickReply, query: str) -> int:
    text = query.strip().lower()
    if not text:
        return 0
    score = 0
    haystacks = [
        (item.title or "", 4),
        (item.body or "", 2),
        (item.category or "", 3),
        (item.tags or "", 3),
        (item.shortcut or "", 1),
    ]
    tokens = [token for token in re.split(r"\s+", text) if len(token) >= 2]
    for haystack, weight in haystacks:
        lowered = haystack.lower()
        if text in lowered:
            score += weight * 3
        for token in tokens:
            if token in lowered:
                score += weight
    return score


async def suggest_quick_replies(
    db: AsyncSession,
    *,
    account_id: UUID,
    query: str,
    organization_id: UUID | None = None,
    channel_id: UUID | None = None,
    limit: int = 5,
) -> list[QuickReply]:
    items = await list_quick_replies(
        db,
        account_id,
        organization_id=organization_id,
        channel_id=channel_id,
        active_only=True,
    )
    scored = [(item, _score_reply(item, query)) for item in items]
    scored = [pair for pair in scored if pair[1] > 0]
    scored.sort(key=lambda pair: (-pair[1], -pair[0].usage_count, pair[0].sort_order))
    return [item for item, _ in scored[:limit]]


async def export_quick_replies_csv(db: AsyncSession, account_id: UUID) -> str:
    items = await list_quick_replies(db, account_id, active_only=False)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "shortcut",
        "title",
        "body",
        "category",
        "tags",
        "tone_variant",
        "sort_order",
        "is_shared",
        "is_active",
        "organization_id",
        "channel_id",
    ])
    for item in items:
        writer.writerow([
            item.shortcut,
            item.title,
            item.body,
            item.category or "",
            item.tags or "",
            item.tone_variant or "",
            item.sort_order,
            item.is_shared,
            item.is_active,
            str(item.organization_id),
            str(item.channel_id) if item.channel_id else "",
        ])
    return buffer.getvalue()


async def import_quick_replies_csv(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    content: str,
) -> dict:
    organization = await db.get(Organization, organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    reader = csv.DictReader(io.StringIO(content))
    created = 0
    updated = 0
    for row in reader:
        shortcut = (row.get("shortcut") or "").strip()
        title = (row.get("title") or "").strip()
        body = (row.get("body") or "").strip()
        if not shortcut or not title or not body:
            continue
        existing = (
            await db.execute(
                select(QuickReply).where(
                    QuickReply.account_id == account_id,
                    QuickReply.organization_id == organization_id,
                    QuickReply.shortcut == shortcut,
                )
            )
        ).scalar_one_or_none()
        payload = {
            "title": title,
            "body": body,
            "category": (row.get("category") or "").strip() or None,
            "tags": _normalize_tags((row.get("tags") or "").strip() or None),
            "tone_variant": (row.get("tone_variant") or "").strip() or None,
            "sort_order": int(row.get("sort_order") or 0),
            "is_shared": str(row.get("is_shared", "true")).lower() not in {"false", "0", "no"},
            "is_active": str(row.get("is_active", "true")).lower() not in {"false", "0", "no"},
        }
        if existing:
            for key, value in payload.items():
                setattr(existing, key, value)
            updated += 1
        else:
            db.add(
                QuickReply(
                    account_id=account_id,
                    organization_id=organization_id,
                    created_by_user_id=user_id,
                    shortcut=shortcut,
                    **payload,
                )
            )
            created += 1
    await db.commit()
    return {"created": created, "updated": updated}


async def seed_starter_library(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    organization_id: UUID,
) -> dict:
    organization = await db.get(Organization, organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    created = 0
    skipped = 0
    for row in STARTER_REPLIES:
        existing = (
            await db.execute(
                select(QuickReply).where(
                    QuickReply.account_id == account_id,
                    QuickReply.organization_id == organization_id,
                    QuickReply.shortcut == row["shortcut"],
                )
            )
        ).scalar_one_or_none()
        if existing:
            skipped += 1
            continue
        db.add(
            QuickReply(
                account_id=account_id,
                organization_id=organization_id,
                created_by_user_id=user_id,
                is_shared=True,
                is_active=True,
                **row,
            )
        )
        created += 1
    await db.commit()
    return {"created": created, "skipped": skipped}


async def create_from_conversation(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    payload: QuickReplyFromConversationRequest,
) -> QuickReply:
    conversation = await db.get(Conversation, payload.conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.direction == MessageDirection.OUTBOUND,
            Message.text_body.is_not(None),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    message = result.scalar_one_or_none()
    if message is None or not (message.text_body or "").strip():
        raise ValueError("NO_OUTBOUND_MESSAGE")
    body = message.text_body.strip()
    title = (payload.title or body[:60]).strip()
    shortcut = (payload.shortcut or f"/reply-{title[:20].replace(' ', '-')}").strip()
    if not SHORTCUT_PATTERN.match(shortcut):
        shortcut = "/reply"
    item = QuickReply(
        account_id=account_id,
        organization_id=conversation.organization_id,
        channel_id=conversation.channel_id,
        created_by_user_id=user_id,
        shortcut=shortcut,
        title=title,
        body=body,
        category=payload.category or "general",
        tags=payload.tags,
        is_shared=True,
        is_active=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def quick_replies_report(db: AsyncSession, *, account_id: UUID, limit: int = 50) -> dict:
    items = await list_quick_replies(db, account_id, active_only=True)
    unused = [item for item in items if (item.usage_count or 0) == 0]
    top_used = sorted(items, key=lambda item: item.usage_count or 0, reverse=True)
    by_category: dict[str, int] = {}
    for item in items:
        cat = item.category or "general"
        by_category[cat] = by_category.get(cat, 0) + 1
    return {
        "summary": {
            "total": len(items),
            "unused": len(unused),
            "total_usage": sum(item.usage_count or 0 for item in items),
        },
        "top_used": [_reply_row(item) for item in top_used if item.usage_count > 0][:limit],
        "unused": [_reply_row(item) for item in unused[:limit]],
        "by_category": [{"category": cat, "count": count} for cat, count in sorted(by_category.items())],
    }
