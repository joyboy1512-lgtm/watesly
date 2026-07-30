from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.conversation_note import ConversationNote
from app.models.conversation_tag import ConversationTag
from app.models.organization import Organization
from app.models.tag import Tag
from app.schemas.inbox_tools import (
    NoteCreateRequest,
    TagCreateRequest,
)
from app.services.quick_replies import create_quick_reply, list_quick_replies


async def create_tag(db: AsyncSession, account_id: UUID, payload: TagCreateRequest) -> Tag:
    organization = await db.get(Organization, payload.organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    tag = Tag(account_id=account_id, **payload.model_dump())
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


async def list_tags(db: AsyncSession, account_id: UUID) -> list[Tag]:
    result = await db.execute(
        select(Tag).where(Tag.account_id == account_id).order_by(Tag.name.asc())
    )
    return list(result.scalars().all())


async def add_tag_to_conversation(
    db: AsyncSession, account_id: UUID, conversation_id: UUID, tag_id: UUID
) -> list[UUID]:
    conversation = await db.get(Conversation, conversation_id)
    tag = await db.get(Tag, tag_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    if tag is None or tag.account_id != account_id:
        raise ValueError("TAG_NOT_FOUND")
    existing = await db.execute(
        select(ConversationTag).where(
            ConversationTag.conversation_id == conversation_id,
            ConversationTag.tag_id == tag_id,
        )
    )
    run_ids: list[UUID] = []
    if existing.scalar_one_or_none() is None:
        db.add(ConversationTag(conversation_id=conversation_id, tag_id=tag_id))
        await db.flush()
        from app.models.automation import AutomationTriggerType
        from app.services.automation_triggers import (
            build_conversation_trigger_payload,
            dispatch_automation_runs,
            queue_automation_runs,
        )

        trigger_payload = await build_conversation_trigger_payload(
            db, conversation, tag_id=str(tag_id)
        )
        run_ids = await queue_automation_runs(
            db,
            account_id=account_id,
            trigger_type=AutomationTriggerType.TAG_ADDED,
            trigger_payload=trigger_payload,
        )
    await db.commit()
    dispatch_automation_runs(run_ids)
    return run_ids


async def remove_tag_from_conversation(
    db: AsyncSession, account_id: UUID, conversation_id: UUID, tag_id: UUID
) -> None:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    await db.execute(
        delete(ConversationTag).where(
            ConversationTag.conversation_id == conversation_id,
            ConversationTag.tag_id == tag_id,
        )
    )
    await db.commit()


async def create_note(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
    user_id: UUID,
    payload: NoteCreateRequest,
) -> ConversationNote:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    note = ConversationNote(
        conversation_id=conversation_id,
        user_id=user_id,
        body=payload.body,
        mentions=payload.mentions or None,
        is_internal=True,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return note


async def list_notes(
    db: AsyncSession, account_id: UUID, conversation_id: UUID
) -> list[ConversationNote]:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")
    result = await db.execute(
        select(ConversationNote)
        .where(ConversationNote.conversation_id == conversation_id)
        .order_by(ConversationNote.created_at.asc())
    )
    return list(result.scalars().all())


async def list_conversation_tags(
    db: AsyncSession, account_id: UUID, conversation_id: UUID
) -> list[Tag]:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id:
        raise ValueError("CONVERSATION_NOT_FOUND")

    result = await db.execute(
        select(Tag)
        .join(ConversationTag, ConversationTag.tag_id == Tag.id)
        .where(ConversationTag.conversation_id == conversation_id)
        .order_by(Tag.name.asc())
    )
    return list(result.scalars().all())
