from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.db.session import get_db
from app.core.permissions import Permission
from app.schemas.billing import ChannelBillingUpdateRequest
from app.schemas.channel import ChannelCreateRequest, ChannelResponse
from app.schemas.mac import ChannelUsageBoardResponse
from app.services.billing_provider import update_channel_billing
from app.services.membership_access import ensure_membership_organization_access
from app.services.channels import create_channel, get_channel_usage_board, list_channels
from app.services.membership_access import filter_channels_for_membership

router = APIRouter()


@router.get("", response_model=list[ChannelResponse])
async def get_channels(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    channels = await list_channels(db, context.account_id)
    return await filter_channels_for_membership(
        db,
        account_id=context.account_id,
        membership=context.membership,
        channels=channels,
    )


@router.get("/usage-board", response_model=ChannelUsageBoardResponse)
async def get_channels_usage_board(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await get_channel_usage_board(db, account_id=context.account_id)


@router.post("", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def post_channel(
    payload: ChannelCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await ensure_membership_organization_access(
            db,
            account_id=context.account_id,
            membership=context.membership,
            organization_id=payload.organization_id,
        )
        return await create_channel(db, account_id=context.account_id, payload=payload)
    except ValueError as exc:
        if str(exc) == "ACCESS_FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        messages = {
            "INVALID_ORGANIZATION": (400, "Organization is invalid"),
            "NO_ACTIVE_SUBSCRIPTION": (402, "An active subscription is required"),
            "CHANNEL_LIMIT_REACHED": (403, "Channel limit reached for this plan"),
            "ORG_CHANNEL_LIMIT_REACHED": (403, "Channel limit reached for this branch"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to create channel"))
        raise HTTPException(status_code=code, detail=detail) from exc


@router.patch("/{channel_id}/billing", response_model=ChannelUsageBoardResponse)
async def patch_channel_billing(
    channel_id: UUID,
    payload: ChannelBillingUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.BILLING_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
) -> ChannelUsageBoardResponse:
    try:
        await update_channel_billing(
            db,
            account_id=context.account_id,
            channel_id=channel_id,
            payload=payload,
        )
    except ValueError as exc:
        if str(exc) == "CHANNEL_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Channel not found") from exc
        raise
    return await get_channel_usage_board(db, account_id=context.account_id)
