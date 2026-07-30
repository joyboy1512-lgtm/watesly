from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.notification import NotificationResponse
from app.services.notifications import list_notifications, mark_notification_read

router = APIRouter()


@router.get("", response_model=list[NotificationResponse])
async def get_notifications(
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_notifications(
        db,
        account_id=context.account_id,
        user_id=context.user.id,
    )


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def read_notification(
    notification_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await mark_notification_read(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            notification_id=notification_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Notification not found") from exc
