from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.conversation_read_state import ConversationReadState
from app.models.message import Message
from app.models.membership import Membership


async def get_or_create_read_state(
    db: AsyncSession, *, conversation_id: UUID, membership_id: UUID
) -> ConversationReadState:
    result = await db.execute(
        select(ConversationReadState).where(
            ConversationReadState.conversation_id == conversation_id,
            ConversationReadState.membership_id == membership_id,
        )
    )
    state = result.scalar_one_or_none()
    if state is None:
        state = ConversationReadState(conversation_id=conversation_id, membership_id=membership_id, unread_count=0)
        db.add(state)
        await db.flush()
    return state


async def compute_unread_count(db: AsyncSession, *, conversation_id: UUID, membership_id: UUID) -> int:
    state = await get_or_create_read_state(db, conversation_id=conversation_id, membership_id=membership_id)
    query = select(func.count(Message.id)).where(
        Message.conversation_id == conversation_id,
        Message.direction == "inbound",
    )
    if state.last_read_at:
        query = query.where(Message.created_at > state.last_read_at)
    return int((await db.scalar(query)) or 0)


async def mark_conversation_read(
    db: AsyncSession, *, account_id: UUID, conversation_id: UUID, membership: Membership
) -> ConversationReadState:
    from sqlalchemy import desc

    from app.core.encryption import decrypt_secret
    from app.models.message import Message, MessageDirection
    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.meta_client import MetaAPIError, MetaWhatsAppClient

    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    state = await get_or_create_read_state(db, conversation_id=conversation_id, membership_id=membership.id)
    state.last_read_at = datetime.now(UTC)
    state.unread_count = 0
    await db.commit()

    last_inbound = await db.scalar(
        select(Message.external_message_id)
        .where(
            Message.conversation_id == conversation_id,
            Message.direction == MessageDirection.INBOUND,
            Message.external_message_id.is_not(None),
        )
        .order_by(desc(Message.created_at))
        .limit(1)
    )
    if last_inbound:
        wa = await db.scalar(
            select(WhatsAppAccount).where(WhatsAppAccount.channel_id == conversation.channel_id)
        )
        if wa is not None:
            client = MetaWhatsAppClient(
                access_token=decrypt_secret(wa.access_token_encrypted),
                phone_number_id=wa.phone_number_id,
            )
            try:
                await client.mark_message_read(message_id=str(last_inbound))
            except MetaAPIError:
                pass
            finally:
                await client.aclose()

    await db.refresh(state)
    return state


async def mark_conversation_unread(
    db: AsyncSession, *, account_id: UUID, conversation_id: UUID, membership: Membership
) -> ConversationReadState:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    state = await get_or_create_read_state(db, conversation_id=conversation_id, membership_id=membership.id)
    state.last_read_at = None
    state.unread_count = max(await compute_unread_count(db, conversation_id=conversation_id, membership_id=membership.id), 1)
    await db.commit()
    await db.refresh(state)
    return state


async def star_conversation(db: AsyncSession, *, account_id: UUID, conversation_id: UUID, starred: bool) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    conversation.is_starred = starred
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def snooze_conversation(
    db: AsyncSession, *, account_id: UUID, conversation_id: UUID, until: datetime | None
) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    conversation.snoozed_until = until
    await db.commit()
    await db.refresh(conversation)
    return conversation


async def archive_conversation(db: AsyncSession, *, account_id: UUID, conversation_id: UUID, archived: bool) -> Conversation:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    conversation.archived_at = datetime.now(UTC) if archived else None
    await db.commit()
    await db.refresh(conversation)
    return conversation
