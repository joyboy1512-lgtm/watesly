from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.db.session import get_db
from app.core.permissions import Permission
from app.schemas.channel import ChannelCreateRequest, ChannelResponse
from app.services.channels import create_channel, list_channels

router = APIRouter()


@router.get("", response_model=list[ChannelResponse])
async def get_channels(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_channels(db, context.account_id)


@router.post("", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def post_channel(
    payload: ChannelCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_channel(db, account_id=context.account_id, payload=payload)
    except ValueError as exc:
        messages = {
            "INVALID_ORGANIZATION": (400, "Organization is invalid"),
            "NO_ACTIVE_SUBSCRIPTION": (402, "An active subscription is required"),
            "CHANNEL_LIMIT_REACHED": (403, "Channel limit reached for this plan"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to create channel"))
        raise HTTPException(status_code=code, detail=detail) from exc
