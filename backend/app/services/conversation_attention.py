"""Shared «needs reply / تنتظر الرد» definition for inbox + dashboard.

A conversation needs a reply when:
- not deleted / not archived
- status is open or pending
- not currently snoozed
- latest message is inbound from the customer
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageDirection


def latest_message_id_subquery():
    return (
        select(Message.id)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
        .correlate(Conversation)
        .scalar_subquery()
    )


def waiting_reply_predicates(*, now: datetime | None = None) -> list[ColumnElement[bool]]:
    current = now or datetime.now(UTC)
    return [
        Conversation.deleted_at.is_(None),
        Conversation.archived_at.is_(None),
        Conversation.status.in_([ConversationStatus.OPEN, ConversationStatus.PENDING]),
        Message.direction == MessageDirection.INBOUND,
        (Conversation.snoozed_until.is_(None)) | (Conversation.snoozed_until <= current),
    ]


def waiting_reply_base_query(*, account_id: UUID, now: datetime | None = None) -> Select:
    current = now or datetime.now(UTC)
    latest_id = latest_message_id_subquery()
    return (
        select(Conversation.id)
        .select_from(Conversation)
        .join(Contact, Contact.id == Conversation.contact_id)
        .join(Message, Message.id == latest_id)
        .where(
            Conversation.account_id == account_id,
            Contact.deleted_at.is_(None),
            *waiting_reply_predicates(now=current),
        )
    )


async def count_waiting_reply(
    db: AsyncSession,
    *,
    account_id: UUID,
    assigned_membership_id: UUID | None = None,
    channel_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> int:
    query = waiting_reply_base_query(account_id=account_id)
    if assigned_membership_id is not None:
        query = query.where(Conversation.assigned_membership_id == assigned_membership_id)
    if channel_id is not None:
        query = query.where(Conversation.channel_id == channel_id)
    if organization_id is not None:
        query = query.where(Conversation.organization_id == organization_id)
    value = await db.scalar(select(func.count()).select_from(query.subquery()))
    return int(value or 0)
