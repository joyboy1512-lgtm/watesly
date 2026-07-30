from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.conversation import Conversation, ConversationStatus
from app.models.conversation_event import ConversationEvent
from app.models.conversation_read_state import ConversationReadState
from app.models.membership import Membership
from app.models.message import Message, MessageDirection
from app.services.notifications import create_notification
from app.services.whatsapp_window import compute_service_window
from app.schemas.conversation import ConversationUpdateRequest, ConversationResponse


def build_conversation_response(
    *,
    conversation: Conversation,
    contact: Contact,
    message: Message | None,
    unread: int,
    last_inbound_at: datetime | None,
) -> ConversationResponse:
    window = compute_service_window(last_inbound_at)
    now = datetime.now(UTC)
    last_message_direction = None
    needs_reply = False
    waiting_minutes = None
    if message is not None:
        last_message_direction = (
            message.direction.value
            if hasattr(message.direction, "value")
            else str(message.direction)
        )
        if (
            last_message_direction == MessageDirection.INBOUND
            and conversation.status in {ConversationStatus.OPEN, ConversationStatus.PENDING}
            and conversation.archived_at is None
        ):
            needs_reply = True
            if conversation.last_message_at:
                waiting_minutes = max(
                    0,
                    int((now - conversation.last_message_at).total_seconds() // 60),
                )
    return ConversationResponse(
        id=conversation.id,
        organization_id=conversation.organization_id,
        channel_id=conversation.channel_id,
        contact_id=conversation.contact_id,
        assigned_membership_id=conversation.assigned_membership_id,
        status=conversation.status,
        priority=conversation.priority,
        last_message_at=conversation.last_message_at,
        first_response_at=conversation.first_response_at,
        closed_at=conversation.closed_at,
        is_starred=conversation.is_starred,
        snoozed_until=conversation.snoozed_until,
        archived_at=conversation.archived_at,
        unread_count=unread,
        contact_name=contact.display_name,
        contact_address=contact.external_address,
        last_message_text=message.text_body if message else None,
        last_message_status=message.status if message else None,
        last_inbound_at=window["last_inbound_at"],
        service_window_open=window["service_window_open"],
        service_window_expires_at=window["service_window_expires_at"],
        requires_template=window["requires_template"],
        last_message_direction=last_message_direction,
        needs_reply=needs_reply,
        waiting_minutes=waiting_minutes,
    )


async def list_conversations(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
    limit: int = 100,
    include_archived: bool = False,
    archived_only: bool = False,
    starred_only: bool = False,
) -> list[tuple[Conversation, Contact, Message | None, int]]:
    latest_message_id = (
        select(Message.id)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
        .correlate(Conversation)
        .scalar_subquery()
    )
    now = datetime.now(UTC)
    query = (
        select(Conversation, Contact, Message, ConversationReadState.unread_count)
        .join(Contact, Contact.id == Conversation.contact_id)
        .outerjoin(Message, Message.id == latest_message_id)
        .outerjoin(
            ConversationReadState,
            (ConversationReadState.conversation_id == Conversation.id)
            & (ConversationReadState.membership_id == membership.id),
        )
        .where(
            Conversation.account_id == account_id,
            Conversation.deleted_at.is_(None),
            Contact.deleted_at.is_(None),
        )
        .order_by(desc(Conversation.last_message_at))
        .limit(min(max(limit, 1), 200))
    )
    if archived_only:
        query = query.where(Conversation.archived_at.is_not(None))
    elif not include_archived:
        query = query.where(Conversation.archived_at.is_(None))
    query = query.where((Conversation.snoozed_until.is_(None)) | (Conversation.snoozed_until <= now))
    if starred_only:
        query = query.where(Conversation.is_starred.is_(True))
    if membership.role.value in {"agent", "viewer"}:
        query = query.where(Conversation.assigned_membership_id == membership.id)
    rows = list((await db.execute(query)).all())
    result = []
    for conversation, contact, message, unread in rows:
        result.append((conversation, contact, message, int(unread or 0)))
    return result


async def list_messages(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
    membership: Membership,
) -> list[Message]:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id or conversation.deleted_at is not None:
        raise ValueError("CONVERSATION_NOT_FOUND")
    if membership.role.value in {"agent", "viewer"}:
        if conversation.assigned_membership_id != membership.id:
            raise ValueError("CONVERSATION_FORBIDDEN")

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    return list(result.scalars().all())


async def update_conversation(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
    actor_user_id: UUID,
    payload: ConversationUpdateRequest,
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id or conversation.deleted_at is not None:
        raise ValueError("CONVERSATION_NOT_FOUND")

    changes = {}
    automation_run_ids: list = []
    if payload.assigned_membership_id is not None:
        membership = await db.get(Membership, payload.assigned_membership_id)
        if membership is None or membership.account_id != account_id:
            raise ValueError("INVALID_ASSIGNEE")
        changes["assigned_membership_id"] = str(payload.assigned_membership_id)
        conversation.assigned_membership_id = payload.assigned_membership_id

        await create_notification(
            db,
            account_id=account_id,
            user_id=membership.user_id,
            type="conversation_assigned",
            title="تم تعيين محادثة لك",
            body="تم تحويل محادثة جديدة إلى حسابك.",
            data={"conversation_id": str(conversation.id)},
        )
        from app.models.automation import AutomationTriggerType
        from app.services.automation_triggers import (
            build_conversation_trigger_payload,
            queue_automation_runs,
        )

        trigger_payload = await build_conversation_trigger_payload(
            db,
            conversation,
            assigned_membership_id=str(payload.assigned_membership_id),
        )
        automation_run_ids = await queue_automation_runs(
            db,
            account_id=account_id,
            trigger_type=AutomationTriggerType.CONVERSATION_ASSIGNED,
            trigger_payload=trigger_payload,
        )

    if payload.status is not None:
        changes["status"] = payload.status.value
        conversation.status = payload.status
        if payload.status == ConversationStatus.CLOSED:
            conversation.closed_at = datetime.now(UTC)
        elif conversation.closed_at is not None:
            conversation.closed_at = None

    if payload.priority is not None:
        changes["priority"] = payload.priority.value
        conversation.priority = payload.priority

    if payload.is_starred is not None:
        changes["is_starred"] = payload.is_starred
        conversation.is_starred = payload.is_starred

    if "snoozed_until" in payload.model_fields_set:
        changes["snoozed_until"] = payload.snoozed_until.isoformat() if payload.snoozed_until else None
        conversation.snoozed_until = payload.snoozed_until

    if payload.archived is not None:
        conversation.archived_at = datetime.now(UTC) if payload.archived else None
        changes["archived"] = payload.archived

    db.add(
        ConversationEvent(
            conversation_id=conversation.id,
            actor_user_id=actor_user_id,
            event_type="conversation_updated",
            data=changes,
        )
    )
    await db.commit()
    await db.refresh(conversation)
    if automation_run_ids:
        from app.services.automation_triggers import dispatch_automation_runs

        dispatch_automation_runs(automation_run_ids)
    return conversation


async def get_conversation_for_send(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
    membership: Membership,
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id or conversation.deleted_at is not None:
        raise ValueError("CONVERSATION_NOT_FOUND")
    if membership.role.value in {"agent", "viewer"}:
        if conversation.assigned_membership_id != membership.id:
            raise ValueError("CONVERSATION_FORBIDDEN")
    return conversation
