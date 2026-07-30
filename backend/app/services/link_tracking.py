"""Tracked links for campaign click attribution (Wati-style)."""

from __future__ import annotations

import re
import secrets
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.tracked_link import LinkClick, TrackedLink

REF_PATTERN = re.compile(r"ref:([a-zA-Z0-9_-]{4,32})", re.IGNORECASE)
CSAT_PATTERN = re.compile(r"(?:csat|تقييم)\s*[:：]?\s*([1-5])", re.IGNORECASE)


def build_wa_me_url(phone: str, message: str | None, slug: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    base = f"https://wa.me/{digits}"
    parts = []
    if message and message.strip():
        parts.append(message.strip())
    parts.append(f"ref:{slug}")
    text = " ".join(parts)
    return f"{base}?text={quote(text)}"


def public_track_url(slug: str, api_base: str = "/api/v1") -> str:
    return f"{api_base.rstrip('/')}/r/{slug}"


async def create_tracked_link(
    db: AsyncSession,
    *,
    account_id: UUID,
    name: str,
    phone_number: str,
    prefill_message: str | None = None,
    campaign_id: UUID | None = None,
) -> TrackedLink:
    slug = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:10]
    link = TrackedLink(
        account_id=account_id,
        campaign_id=campaign_id,
        name=name,
        slug=slug,
        phone_number=phone_number,
        prefill_message=prefill_message,
        click_count=0,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def get_tracked_link_by_slug(db: AsyncSession, slug: str) -> TrackedLink | None:
    result = await db.execute(select(TrackedLink).where(TrackedLink.slug == slug))
    return result.scalar_one_or_none()


async def record_click_and_redirect_url(
    db: AsyncSession,
    *,
    slug: str,
    referrer: str | None,
    user_agent: str | None,
) -> str | None:
    link = await get_tracked_link_by_slug(db, slug)
    if link is None:
        return None
    db.add(
        LinkClick(
            tracked_link_id=link.id,
            referrer=(referrer or "")[:500] or None,
            user_agent=(user_agent or "")[:500] or None,
        )
    )
    link.click_count = (link.click_count or 0) + 1
    await db.commit()
    return build_wa_me_url(link.phone_number, link.prefill_message, link.slug)


async def apply_inbound_attribution(
    db: AsyncSession,
    *,
    contact: Contact,
    text_body: str | None,
) -> TrackedLink | None:
    if not text_body:
        return None
    match = REF_PATTERN.search(text_body)
    if not match:
        return None
    slug = match.group(1)
    link = await get_tracked_link_by_slug(db, slug)
    if link is None or link.account_id != contact.account_id:
        return None
    contact.source_tracked_link_id = link.id
    if link.campaign_id:
        contact.source_campaign_id = link.campaign_id
    await db.flush()
    return link


def parse_csat_score(text_body: str | None) -> int | None:
    if not text_body:
        return None
    match = CSAT_PATTERN.search(text_body)
    if not match:
        return None
    score = int(match.group(1))
    return score if 1 <= score <= 5 else None
