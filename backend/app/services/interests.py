from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import Contact
from app.models.contact_interest import ContactInterest
from app.models.interest_category import InterestCategory

DEFAULT_INTEREST_CATEGORIES: list[dict] = [
    {"slug": "beauty", "label": "تجميل وعناية", "exclude_genders": ["male"], "sort_order": 10},
    {"slug": "fashion", "label": "أزياء وموضة", "exclude_genders": [], "sort_order": 20},
    {"slug": "electronics", "label": "إلكترونيات", "exclude_genders": [], "sort_order": 30},
    {"slug": "home", "label": "منزل ومطبخ", "exclude_genders": [], "sort_order": 40},
    {"slug": "kids", "label": "أطفال", "exclude_genders": [], "sort_order": 50},
    {"slug": "sports", "label": "رياضة", "exclude_genders": [], "sort_order": 60},
    {"slug": "health", "label": "صحة وعافية", "exclude_genders": [], "sort_order": 70},
    {"slug": "automotive", "label": "سيارات", "exclude_genders": [], "sort_order": 80},
    {"slug": "food", "label": "طعام ومشروبات", "exclude_genders": [], "sort_order": 90},
    {"slug": "general", "label": "عام", "exclude_genders": [], "sort_order": 100},
]


async def ensure_default_interests(db: AsyncSession, account_id: UUID) -> None:
    count = await db.scalar(
        select(InterestCategory.id).where(InterestCategory.account_id == account_id).limit(1)
    )
    if count is not None:
        return
    db.add_all([
        InterestCategory(account_id=account_id, **item)
        for item in DEFAULT_INTEREST_CATEGORIES
    ])
    await db.commit()


async def list_interests(db: AsyncSession, account_id: UUID) -> list[InterestCategory]:
    await ensure_default_interests(db, account_id)
    result = await db.execute(
        select(InterestCategory)
        .where(InterestCategory.account_id == account_id)
        .order_by(InterestCategory.sort_order.asc(), InterestCategory.label.asc())
    )
    return list(result.scalars().all())


async def create_interest(
    db: AsyncSession,
    *,
    account_id: UUID,
    slug: str,
    label: str,
    exclude_genders: list[str] | None = None,
    include_genders: list[str] | None = None,
) -> InterestCategory:
    item = InterestCategory(
        account_id=account_id,
        slug=slug.strip().lower()[:80],
        label=label.strip()[:160],
        exclude_genders=exclude_genders or [],
        include_genders=include_genders or None,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def list_contact_interest_ids(db: AsyncSession, contact_id: UUID) -> list[UUID]:
    result = await db.execute(
        select(ContactInterest.interest_id).where(ContactInterest.contact_id == contact_id)
    )
    return list(result.scalars().all())


async def list_contact_interests(db: AsyncSession, account_id: UUID, contact_id: UUID) -> list[InterestCategory]:
    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")
    result = await db.execute(
        select(InterestCategory)
        .join(ContactInterest, ContactInterest.interest_id == InterestCategory.id)
        .where(ContactInterest.contact_id == contact_id, InterestCategory.account_id == account_id)
        .order_by(InterestCategory.sort_order.asc())
    )
    return list(result.scalars().all())


async def apply_contact_interests(
    db: AsyncSession,
    *,
    account_id: UUID,
    contact_id: UUID,
    interest_ids: list[UUID],
) -> None:
    if not interest_ids:
        await db.execute(delete(ContactInterest).where(ContactInterest.contact_id == contact_id))
        return

    contact = await db.get(Contact, contact_id)
    if contact is None or contact.account_id != account_id:
        raise ValueError("CONTACT_NOT_FOUND")

    result = await db.execute(
        select(InterestCategory.id).where(
            InterestCategory.account_id == account_id,
            InterestCategory.id.in_(interest_ids),
        )
    )
    valid_ids = set(result.scalars().all())
    if valid_ids != set(interest_ids):
        raise ValueError("INVALID_INTEREST")

    await db.execute(delete(ContactInterest).where(ContactInterest.contact_id == contact_id))
    db.add_all([
        ContactInterest(contact_id=contact_id, interest_id=interest_id)
        for interest_id in valid_ids
    ])


def merge_interest_gender_rules(categories: list[InterestCategory]) -> tuple[set[str], set[str]]:
    exclude: set[str] = set()
    include: set[str] = set()
    for category in categories:
        for value in category.exclude_genders or []:
            if value in {"male", "female", "unknown"}:
                exclude.add(value)
        for value in category.include_genders or []:
            if value in {"male", "female", "unknown"}:
                include.add(value)
    if include:
        return exclude, include
    return exclude, set()
