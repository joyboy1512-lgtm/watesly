"""Non-interactive dev super-admin bootstrap. Development use only."""
import argparse
import asyncio
import re

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionFactory
from app.models.account import Account
from app.models.membership import Membership, MembershipRole
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.user import User, UserStatus
from app.services.billing import create_trial_subscription, get_active_subscription


def make_slug(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "watesly-admin"


async def bootstrap(email: str, password: str, full_name: str) -> None:
    if len(password) < 10:
        raise SystemExit("Password must be at least 10 characters.")

    async with AsyncSessionFactory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()

        if user is None:
            user = User(
                email=email,
                full_name=full_name,
                password_hash=hash_password(password),
                preferred_language="ar",
                is_super_admin=True,
                status=UserStatus.ACTIVE,
            )
            db.add(user)
            await db.flush()
        else:
            user.full_name = full_name or user.full_name
            user.password_hash = hash_password(password)
            user.is_super_admin = True
            user.status = UserStatus.ACTIVE
            await db.flush()

        membership = (
            await db.execute(
                select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at.asc())
            )
        ).scalars().first()

        if membership is None:
            account = Account(name=f"{full_name} Account")
            db.add(account)
            await db.flush()

            slug = f"{make_slug(email.split('@', 1)[0])}-{str(user.id)[:8]}"
            organization = Organization(
                account_id=account.id,
                name=f"{full_name} Organization",
                slug=slug,
                country_code="KW",
                currency_code="KWD",
                timezone="Asia/Kuwait",
                default_language="ar",
            )
            db.add(organization)
            await db.flush()

            membership = Membership(account_id=account.id, user_id=user.id, role=MembershipRole.OWNER)
            db.add(membership)
            await db.flush()

            db.add(OrganizationMembership(organization_id=organization.id, membership_id=membership.id))
        else:
            membership.role = MembershipRole.OWNER

        if await get_active_subscription(db, membership.account_id) is None:
            await create_trial_subscription(db, account_id=membership.account_id)

        await db.commit()
        print(f"Super admin ready: {email}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap a development super admin")
    parser.add_argument("--email", default="admin@example.com")
    parser.add_argument("--password", default="DevPassword123!")
    parser.add_argument("--name", default="Super Admin")
    args = parser.parse_args()
    asyncio.run(bootstrap(args.email.strip().lower(), args.password, args.name.strip()))


if __name__ == "__main__":
    main()
