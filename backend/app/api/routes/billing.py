from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.models.channel import Channel
from app.schemas.billing import SubscriptionResponse
from app.schemas.mac import MacChannelStatsResponse, MacContactItem, MacStatsResponse
from app.services.billing import get_active_subscription
from app.services.mac_tracking import (
    count_campaign_messages_for_channel,
    count_mac_for_channel,
    current_cycle_month,
    get_account_mac_summary,
    list_mac_contacts,
)

router = APIRouter()


@router.get("/subscription", response_model=SubscriptionResponse)
async def current_subscription(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionResponse:
    data = await get_active_subscription(db, context.account_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No active subscription")
    subscription, plan = data
    summary = await get_account_mac_summary(db, account_id=context.account_id)
    return SubscriptionResponse(
        plan_id=plan.id,
        plan_code=plan.code,
        plan_name=plan.name,
        status=subscription.status,
        billing_cycle=subscription.billing_cycle,
        starts_at=subscription.starts_at,
        ends_at=subscription.ends_at,
        max_users=plan.max_users,
        max_organizations=plan.max_organizations,
        max_channels=plan.max_channels,
        included_mac=plan.included_mac,
        over_mac_price_per_100=float(plan.over_mac_price_per_100),
        allow_multi_organization=plan.allow_multi_organization,
        cycle_month=str(summary["cycle_month"]),
        mac_count=int(summary["mac_count"]),
        mac_remaining=int(summary["mac_remaining"]),
        is_over_mac=bool(summary["is_over_mac"]),
        over_mac_count=int(summary["over_mac_count"]),
        over_mac_blocks=int(summary["over_mac_blocks"]),
        estimated_over_mac_charge=float(summary["estimated_over_mac_charge"]),
    )


@router.get("/mac/stats", response_model=MacStatsResponse)
async def get_account_mac_stats(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
    cycle_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> MacStatsResponse:
    summary = await get_account_mac_summary(
        db, account_id=context.account_id, cycle_month=cycle_month
    )
    return MacStatsResponse(
        cycle_month=str(summary["cycle_month"]),
        mac_count=int(summary["mac_count"]),
        included_mac=int(summary["included_mac"]),
        mac_remaining=int(summary["mac_remaining"]),
        is_over_mac=bool(summary["is_over_mac"]),
        over_mac_count=int(summary["over_mac_count"]),
        over_mac_blocks=int(summary["over_mac_blocks"]),
        over_mac_price_per_100=float(summary["over_mac_price_per_100"]),
        estimated_over_mac_charge=float(summary["estimated_over_mac_charge"]),
    )


@router.get("/mac/channels", response_model=list[MacChannelStatsResponse])
async def get_channels_mac_stats(
    context: AuthContext = Depends(require_permissions(Permission.BILLING_VIEW)),
    db: AsyncSession = Depends(get_db),
    cycle_month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> list[MacChannelStatsResponse]:
    from sqlalchemy import select

    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.channels import list_channels

    summary = await get_account_mac_summary(
        db, account_id=context.account_id, cycle_month=cycle_month
    )
    cycle = str(summary["cycle_month"])
    included_mac = int(summary["included_mac"])
    channels = await list_channels(db, context.account_id)
    wa_rows = list(
        (
            await db.execute(
                select(WhatsAppAccount).where(WhatsAppAccount.account_id == context.account_id)
            )
        ).scalars().all()
    )
    wa_by_channel = {item.channel_id: item for item in wa_rows}

    items: list[MacChannelStatsResponse] = []
    for channel in channels:
        mac_count = await count_mac_for_channel(
            db, account_id=context.account_id, channel_id=channel.id, cycle_month=cycle
        )
        campaign_msgs = await count_campaign_messages_for_channel(
            db, account_id=context.account_id, channel_id=channel.id, cycle_month=cycle
        )
        wa = wa_by_channel.get(channel.id)
        items.append(
            MacChannelStatsResponse(
                channel_id=channel.id,
                channel_name=channel.name,
                channel_type=channel.type,
                channel_status=channel.status,
                cycle_month=cycle,
                mac_count=mac_count,
                included_mac=included_mac,
                mac_remaining=max(0, included_mac - int(summary["mac_count"])),
                is_over_mac=bool(summary["is_over_mac"]),
                over_mac_count=max(0, int(summary["mac_count"]) - included_mac),
                campaign_messages_sent=campaign_msgs,
                whatsapp_status=wa.status.value if wa and hasattr(wa.status, "value") else (str(wa.status) if wa else None),
                whatsapp_phone=wa.display_phone_number if wa else None,
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
