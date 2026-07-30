"""Conversation sidebar context: attribution, KB, presence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.models.message import Message, MessageDirection
from app.models.tracked_link import TrackedLink
from app.services.inbox_presence import list_conversation_presence
from app.services.knowledge_base import search_knowledge_articles


async def get_contact_attribution(db: AsyncSession, contact: Contact) -> dict:
    campaign_name = None
    tracked_link_name = None
    if contact.source_campaign_id:
        campaign = await db.get(Campaign, contact.source_campaign_id)
        campaign_name = campaign.name if campaign else None
    if contact.source_tracked_link_id:
        link = await db.get(TrackedLink, contact.source_tracked_link_id)
        tracked_link_name = link.name if link else None
    return {
        "source_campaign_id": contact.source_campaign_id,
        "source_campaign_name": campaign_name,
        "source_tracked_link_id": contact.source_tracked_link_id,
        "source_tracked_link_name": tracked_link_name,
    }


async def get_conversation_context(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation: Conversation,
    contact: Contact,
    membership_id: UUID,
) -> dict:
    attribution = await get_contact_attribution(db, contact)

    last_inbound = (
        await db.execute(
            select(Message)
            .where(
                Message.conversation_id == conversation.id,
                Message.direction == MessageDirection.INBOUND,
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    query_text = (last_inbound.text_body if last_inbound else None) or ""
    articles = await search_knowledge_articles(db, account_id, query_text, limit=3)
    knowledge = [
        {
            "id": str(article.id),
            "title": article.title,
            "body": article.body[:400],
            "category": article.category,
        }
        for article in articles
    ]

    presence = await list_conversation_presence(
        account_id=account_id,
        conversation_id=conversation.id,
        exclude_membership_id=membership_id,
    )

    return {
        "attribution": attribution,
        "knowledge_articles": knowledge,
        "viewers": presence["viewers"],
        "typing": presence["typing"],
        "suggested_query": query_text[:200] if query_text else None,
    }
