from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.conversation_note import ConversationNote
from app.models.membership import Membership
from app.models.user import User


async def list_conversation_timeline(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
) -> list[dict]:
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id or conversation.deleted_at is not None:
        raise ValueError("CONVERSATION_NOT_FOUND")

    events = list(
        (
            await db.execute(
                select(ConversationEvent)
                .where(ConversationEvent.conversation_id == conversation_id)
                .order_by(ConversationEvent.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    notes = list(
        (
            await db.execute(
                select(ConversationNote)
                .where(ConversationNote.conversation_id == conversation_id)
                .order_by(ConversationNote.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    actor_ids = {event.actor_user_id for event in events if event.actor_user_id}
    actor_ids |= {note.user_id for note in notes if note.user_id}
    users = {}
    if actor_ids:
        rows = (
            await db.execute(select(User).where(User.id.in_(list(actor_ids))))
        ).scalars().all()
        users = {row.id: row.full_name for row in rows}

    timeline: list[dict] = []
    for event in events:
        timeline.append(
            {
                "id": str(event.id),
                "kind": "event",
                "event_type": event.event_type,
                "data": event.data or {},
                "actor_name": users.get(event.actor_user_id) if event.actor_user_id else None,
                "created_at": event.created_at.isoformat() if event.created_at else None,
            }
        )
    for note in notes:
        timeline.append(
            {
                "id": str(note.id),
                "kind": "note",
                "event_type": "note.created",
                "data": {"body": note.body},
                "actor_name": users.get(note.user_id) if note.user_id else None,
                "created_at": note.created_at.isoformat() if note.created_at else None,
            }
        )
    timeline.sort(key=lambda item: item.get("created_at") or "")
    return timeline


async def team_membership_ids(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership: Membership,
) -> set[UUID]:
    from app.models.team import Team
    from app.models.team_member import TeamMember

    team_ids = list(
        (
            await db.execute(
                select(TeamMember.team_id).where(TeamMember.membership_id == membership.id)
            )
        )
        .scalars()
        .all()
    )
    if not team_ids:
        return {membership.id}
    member_ids = set(
        (
            await db.execute(
                select(TeamMember.membership_id)
                .join(Team, Team.id == TeamMember.team_id)
                .where(Team.account_id == account_id, TeamMember.team_id.in_(team_ids))
            )
        )
        .scalars()
        .all()
    )
    member_ids.add(membership.id)
    return member_ids
