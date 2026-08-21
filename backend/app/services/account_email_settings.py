"""Account-level email notification settings and recipient resolution."""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import Account
from app.models.membership import Membership, MembershipRole, MembershipStatus
from app.models.user import User

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email_list(values: list[str] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values or []:
        email = str(raw or "").strip().lower()
        if not email or email in seen:
            continue
        if not EMAIL_PATTERN.match(email):
            continue
        seen.add(email)
        normalized.append(email)
    return normalized


def parse_env_email_list(value: str | None) -> list[str]:
    if not value:
        return []
    parts = [part.strip() for part in value.replace(";", ",").split(",")]
    return normalize_email_list(parts)


def serialize_email_settings(account: Account) -> dict:
    return {
        "email_notifications_enabled": bool(account.email_notifications_enabled),
        "notification_emails": normalize_email_list(account.notification_emails or []),
        "catalog_order_emails": normalize_email_list(account.catalog_order_emails or []),
        "email_configured": bool(settings.brevo_api_key or settings.smtp_host),
        "brevo_configured": bool(settings.brevo_api_key and settings.smtp_from_email),
        "smtp_configured": bool(settings.smtp_host and settings.smtp_from_email),
    }


async def get_email_settings(db: AsyncSession, *, account_id: UUID) -> dict:
    account = await db.get(Account, account_id)
    if account is None:
        raise ValueError("ACCOUNT_NOT_FOUND")
    return serialize_email_settings(account)


async def update_email_settings(
    db: AsyncSession,
    *,
    account_id: UUID,
    email_notifications_enabled: bool | None = None,
    notification_emails: list[str] | None = None,
    catalog_order_emails: list[str] | None = None,
) -> dict:
    account = await db.get(Account, account_id)
    if account is None:
        raise ValueError("ACCOUNT_NOT_FOUND")
    if email_notifications_enabled is not None:
        account.email_notifications_enabled = email_notifications_enabled
    if notification_emails is not None:
        account.notification_emails = normalize_email_list(notification_emails)
    if catalog_order_emails is not None:
        account.catalog_order_emails = normalize_email_list(catalog_order_emails)
    await db.commit()
    await db.refresh(account)
    return serialize_email_settings(account)


async def _admin_fallback_emails(db: AsyncSession, *, account_id: UUID) -> list[str]:
    rows = (
        await db.execute(
            select(User.email)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.account_id == account_id,
                Membership.status == MembershipStatus.ACTIVE,
                Membership.role.in_(
                    [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.BRANCH_ADMIN]
                ),
            )
            .order_by(User.created_at.asc())
        )
    ).scalars().all()
    return normalize_email_list(list(rows))


async def resolve_notification_recipients(
    db: AsyncSession,
    *,
    account_id: UUID,
    user_id: UUID | None = None,
) -> list[str]:
    account = await db.get(Account, account_id)
    if account is None or not account.email_notifications_enabled:
        return []

    recipients = normalize_email_list(account.notification_emails or [])
    if not recipients:
        recipients = parse_env_email_list(settings.notification_emails)
    if not recipients:
        recipients = await _admin_fallback_emails(db, account_id=account_id)

    if user_id is not None:
        user = await db.get(User, user_id)
        if user and user.email:
            recipients = normalize_email_list([user.email, *recipients])

    return recipients


async def resolve_catalog_order_recipients(db: AsyncSession, *, account_id: UUID) -> list[str]:
    account = await db.get(Account, account_id)
    if account is None or not account.email_notifications_enabled:
        return []

    recipients = normalize_email_list(account.catalog_order_emails or [])
    if not recipients:
        recipients = parse_env_email_list(settings.catalog_order_emails)
    if not recipients:
        recipients = normalize_email_list(account.notification_emails or [])
    if not recipients:
        recipients = parse_env_email_list(settings.notification_emails)
    if not recipients:
        recipients = await _admin_fallback_emails(db, account_id=account_id)
    return recipients
