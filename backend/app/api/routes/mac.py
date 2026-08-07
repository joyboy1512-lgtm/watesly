from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.models.channel import Channel
from app.schemas.mac import MacChannelStatsResponse, MacContactItem, MacStatsResponse
from app.services.mac_tracking import (
    count_campaign_messages_for_channel,
    count_mac_for_account,
    count_mac_for_channel,
    current_cycle_month,
    list_mac_contacts,
)

router = APIRouter()


@router.get("/mac/stats", response_model=MacStatsResponse)
async def get_account_mac_stats(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
    cycle_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> MacStatsResponse:
    cycle = cycle_month or current_cycle_month()
    mac_count = await count_mac_for_account(db, account_id=context.account_id, cycle_month=cycle)
    return MacStatsResponse(cycle_month=cycle, mac_count=mac_count)


@router.get("/mac/channels", response_model=list[MacChannelStatsResponse])
async def get_channels_mac_stats(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
    cycle_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> list[MacChannelStatsResponse]:
    from app.services.channels import list_channels

    cycle = cycle_month or current_cycle_month()
    channels = await list_channels(db, context.account_id)
    items: list[MacChannelStatsResponse] = []
    for channel in channels:
        mac_count = await count_mac_for_channel(
            db, account_id=context.account_id, channel_id=channel.id, cycle_month=cycle
        )
        campaign_msgs = await count_campaign_messages_for_channel(
            db, account_id=context.account_id, channel_id=channel.id, cycle_month=cycle
        )
        items.append(
            MacChannelStatsResponse(
                channel_id=channel.id,
                channel_name=channel.name,
                cycle_month=cycle,
                mac_count=mac_count,
                campaign_messages_sent=campaign_msgs,
            )
        )
    return items


@router.get("/mac/contacts", response_model=list[MacContactItem])
async def get_mac_contacts(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
    channel_id: UUID | None = None,
    cycle_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[MacContactItem]:
    rows = await list_mac_contacts(
        db,
        account_id=context.account_id,
        channel_id=channel_id,
        cycle_month=cycle_month,
        limit=limit,
        offset=offset,
    )
    return [MacContactItem(**row) for row in rows]


@router.get("/mac/channels/{channel_id}/contacts", response_model=list[MacContactItem])
async def get_channel_mac_contacts(
    channel_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
    cycle_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[MacContactItem]:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.account_id != context.account_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Channel not found")
    rows = await list_mac_contacts(
        db,
        account_id=context.account_id,
        channel_id=channel_id,
        cycle_month=cycle_month,
        limit=limit,
        offset=offset,
    )
    return [MacContactItem(**row) for row in rows]