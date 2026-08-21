from datetime import UTC, datetime
import logging
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification

logger = logging.getLogger(__name__)


async def create_notification(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID | None,
    type: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> Notification:
    item = Notification(
        account_id=account_id,
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        data=data,
    )
    db.add(item)
    await db.flush()

    try:
        from app.services.email_notifications import dispatch_notification_email

        await dispatch_notification_email(db, notification=item)
    except Exception:
        logger.exception("Notification email dispatch failed for type=%s", type)

    return item


async def list_notifications(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
) -> list[Notification]:
    result = await db.execute(
        select(Notification)
        .where(
            Notification.account_id == account_id,
            or_(Notification.user_id == user_id, Notification.user_id.is_(None)),
        )
        .order_by(Notification.created_at.desc())
        .limit(100)
    )
    return list(result.scalars().all())


async def mark_notification_read(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID,
    notification_id: UUID,
) -> Notification:
    item = await db.get(Notification, notification_id)
    if item is None or item.account_id != account_id:
        raise ValueError("NOTIFICATION_NOT_FOUND")
    if item.user_id not in (None, user_id):
        raise ValueError("NOTIFICATION_NOT_FOUND")
    item.read_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(item)
    return item
