from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.models.tracked_link import TrackedLink
from app.schemas.growth import TrackedLinkCreate, TrackedLinkResponse
from app.services.link_tracking import (
    build_wa_me_url,
    create_tracked_link,
    public_track_url,
    record_click_and_redirect_url,
)

router = APIRouter()


@router.get("/r/{slug}", include_in_schema=True)
async def redirect_tracked_link(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    url = await record_click_and_redirect_url(
        db,
        slug=slug,
        referrer=request.headers.get("referer"),
        user_agent=request.headers.get("user-agent"),
    )
    if url is None:
        raise HTTPException(status_code=404, detail="Link not found")
    return RedirectResponse(url=url, status_code=302)


@router.get("/tracking/links", response_model=list[TrackedLinkResponse])
async def get_tracked_links(
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TrackedLink)
        .where(TrackedLink.account_id == context.account_id)
        .order_by(TrackedLink.created_at.desc())
    )
    items = list(result.scalars().all())
    return [_to_response(item) for item in items]


@router.post("/tracking/links", response_model=TrackedLinkResponse, status_code=status.HTTP_201_CREATED)
async def post_tracked_link(
    payload: TrackedLinkCreate,
    context: AuthContext = Depends(require_permissions(Permission.CAMPAIGNS_CREATE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    link = await create_tracked_link(
        db,
        account_id=context.account_id,
        name=payload.name,
        phone_number=payload.phone_number,
        prefill_message=payload.prefill_message,
        campaign_id=payload.campaign_id,
    )
    return _to_response(link)


def _to_response(link: TrackedLink) -> TrackedLinkResponse:
    return TrackedLinkResponse(
        id=link.id,
        name=link.name,
        slug=link.slug,
        phone_number=link.phone_number,
        prefill_message=link.prefill_message,
        campaign_id=link.campaign_id,
        click_count=link.click_count or 0,
        track_url=public_track_url(link.slug),
        wa_me_url=build_wa_me_url(link.phone_number, link.prefill_message, link.slug),
    )
