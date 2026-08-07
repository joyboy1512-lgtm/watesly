"""CTWA and tracked-link attribution dashboard (read-only aggregates)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.tracked_link import LinkClick, TrackedLink


async def get_ctwa_dashboard(
    db: AsyncSession,
    *,
    account_id: UUID,
    days: int = 30,
) -> dict:
    since = datetime.now(UTC) - timedelta(days=max(1, min(days, 365)))

    ctwa_contacts = (
        await db.execute(
            select(func.count(Contact.id)).where(
                Contact.account_id == account_id,
                Contact.deleted_at.is_(None),
                Contact.referral_json.isnot(None),
                Contact.created_at >= since,
            )
        )
    ).scalar_one() or 0

    utm_rows = (
        await db.execute(
            select(Contact.utm_source, func.count(Contact.id))
            .where(
                Contact.account_id == account_id,
                Contact.deleted_at.is_(None),
                Contact.utm_source.isnot(None),
                Contact.created_at >= since,
            )
            .group_by(Contact.utm_source)
            .order_by(func.count(Contact.id).desc())
            .limit(10)
        )
    ).all()

    campaign_rows = (
        await db.execute(
            select(Contact.utm_campaign, func.count(Contact.id))
            .where(
                Contact.account_id == account_id,
                Contact.deleted_at.is_(None),
                Contact.utm_campaign.isnot(None),
                Contact.created_at >= since,
            )
            .group_by(Contact.utm_campaign)
            .order_by(func.count(Contact.id).desc())
            .limit(10)
        )
    ).all()

    link_rows = (
        await db.execute(
            select(TrackedLink.name, TrackedLink.slug, TrackedLink.click_count, TrackedLink.campaign_id)
            .where(
                TrackedLink.account_id == account_id,
                TrackedLink.created_at >= since,
            )
            .order_by(TrackedLink.click_count.desc())
            .limit(15)
        )
    ).all()

    recent_clicks = (
        await db.scalar(
            select(func.count(LinkClick.id))
            .join(TrackedLink, TrackedLink.id == LinkClick.tracked_link_id)
            .where(
                TrackedLink.account_id == account_id,
                LinkClick.clicked_at >= since,
            )
        )
    ) or 0

    deals_from_ctwa = (
        await db.execute(
            select(func.count(Deal.id))
            .join(Contact, Contact.id == Deal.contact_id)
            .where(
                Deal.account_id == account_id,
                Contact.referral_json.isnot(None),
                Deal.created_at >= since,
            )
        )
    ).scalar_one() or 0

    attributed_campaigns = (
        await db.execute(
            select(Campaign.name, func.count(Contact.id))
            .join(Contact, Contact.source_campaign_id == Campaign.id)
            .where(
                Campaign.account_id == account_id,
                Contact.created_at >= since,
            )
            .group_by(Campaign.id, Campaign.name)
            .order_by(func.count(Contact.id).desc())
            .limit(10)
        )
    ).all()

    return {
        "period_days": days,
        "ctwa_leads": int(ctwa_contacts),
        "tracked_link_clicks": int(recent_clicks),
        "deals_from_ctwa": int(deals_from_ctwa),
        "sources": [{"source": row[0], "count": int(row[1])} for row in utm_rows],
        "campaigns": [{"name": row[0], "count": int(row[1])} for row in campaign_rows],
        "tracked_links": [
            {
                "name": row[0],
                "slug": row[1],
                "clicks": int(row[2] or 0),
                "campaign_id": str(row[3]) if row[3] else None,
            }
            for row in link_rows
        ],
        "attributed_campaigns": [{"name": row[0], "contacts": int(row[1])} for row in attributed_campaigns],
    }
