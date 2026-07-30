from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.tag import Tag


async def global_search(
    db: AsyncSession,
    *,
    account_id: UUID,
    query: str,
    limit: int = 20,
) -> dict:
    term = f"%{query.strip()}%"
    contacts = list(
        (
            await db.execute(
                select(Contact)
                .where(
                    Contact.account_id == account_id,
                    Contact.deleted_at.is_(None),
                    or_(
                        Contact.display_name.ilike(term),
                        Contact.external_address.ilike(term),
                        Contact.email.ilike(term),
                    ),
                )
                .limit(limit)
            )
        ).scalars().all()
    )
    conversations = list(
        (
            await db.execute(
                select(Conversation, Contact)
                .join(Contact, Contact.id == Conversation.contact_id)
                .where(
                    Conversation.account_id == account_id,
                    Conversation.deleted_at.is_(None),
                    or_(
                        Contact.display_name.ilike(term),
                        Contact.external_address.ilike(term),
                    ),
                )
                .limit(limit)
            )
        ).all()
    )
    messages = list(
        (
            await db.execute(
                select(Message)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(
                    Conversation.account_id == account_id,
                    Message.text_body.ilike(term),
                )
                .order_by(Message.created_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    tags = list(
        (
            await db.execute(
                select(Tag).where(Tag.account_id == account_id, Tag.name.ilike(term)).limit(limit)
            )
        ).scalars().all()
    )
    return {
        "contacts": [{"id": str(c.id), "name": c.display_name, "phone": c.external_address} for c in contacts],
        "conversations": [
            {"id": str(conv.id), "contact_name": contact.display_name, "contact_phone": contact.external_address}
            for conv, contact in conversations
        ],
        "messages": [{"id": str(m.id), "conversation_id": str(m.conversation_id), "text": m.text_body} for m in messages],
        "tags": [{"id": str(t.id), "name": t.name} for t in tags],
    }
