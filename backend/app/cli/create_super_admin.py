import asyncio
import getpass
import re

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionFactory
from app.models.account import Account
from app.models.membership import Membership, MembershipRole
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.user import User, UserStatus


def make_slug(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "watesly-admin"


async def main() -> None:
    email = input("Super admin email: ").strip().lower()
    full_name = input("Full name: ").strip() or "Super Admin"
    password = getpass.getpass("Password: ")

    if len(password) < 6:
        raise SystemExit("Password must be at least 6 characters.")

    async with AsyncSessionFactory() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

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

        membership_result = await db.execute(
            select(Membership)
            .where(Membership.user_id == user.id)
            .order_by(Membership.created_at.asc())
        )
        membership = membership_result.scalars().first()

        if membership is None:
            account = Account(name=f"{full_name} Account")
            db.add(account)
            await db.flush()

            base_slug = make_slug(email.split("@", 1)[0])
            slug = f"{base_slug}-{str(user.id)[:8]}"

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

            membership = Membership(
                account_id=account.id,
                user_id=user.id,
                role=MembershipRole.OWNER,
            )
            db.add(membership)
            await db.flush()

            db.add(
                OrganizationMembership(
                    organization_id=organization.id,
                    membership_id=membership.id,
                )
            )
        else:
            membership.role = MembershipRole.OWNER

        await db.commit()
        print(f"Super admin ready: {email}")
        print("Account and membership are ready.")


if __name__ == "__main__":
    asyncio.run(main())
