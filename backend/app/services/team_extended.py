from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_presence import AgentPresence
from app.models.conversation import Conversation
from app.models.department import Department
from app.models.membership import Membership, MembershipStatus
from app.models.organization import Organization


async def create_department(
    db: AsyncSession, *, account_id: UUID, organization_id: UUID, name: str
) -> Department:
    org = await db.get(Organization, organization_id)
    if org is None or org.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")
    item = Department(account_id=account_id, organization_id=organization_id, name=name)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def list_departments(db: AsyncSession, account_id: UUID) -> list[Department]:
    result = await db.execute(
        select(Department).where(Department.account_id == account_id).order_by(Department.name.asc())
    )
    return list(result.scalars().all())


async def set_presence(db: AsyncSession, *, membership_id: UUID, status: str) -> AgentPresence:
    item = await db.get(AgentPresence, membership_id)
    if item is None:
        item = AgentPresence(membership_id=membership_id, status=status, last_seen_at=datetime.now(UTC))
        db.add(item)
    else:
        item.status = status
        item.last_seen_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(item)
    return item


async def list_presence(db: AsyncSession, account_id: UUID) -> list[dict]:
    result = await db.execute(
        select(AgentPresence, Membership)
        .join(Membership, Membership.id == AgentPresence.membership_id)
        .where(Membership.account_id == account_id)
    )
    return [
        {"membership_id": str(m.id), "status": p.status, "last_seen_at": p.last_seen_at, "role": m.role.value}
        for p, m in result.all()
    ]


async def workload_summary(db: AsyncSession, account_id: UUID) -> list[dict]:
    members = list(
        (await db.execute(select(Membership).where(Membership.account_id == account_id, Membership.status == MembershipStatus.ACTIVE))).scalars().all()
    )
    summary = []
    for member in members:
        open_count = int(
            (await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == account_id,
                    Conversation.assigned_membership_id == member.id,
                    Conversation.status.in_(["open", "pending"]),
                    Conversation.deleted_at.is_(None),
                )
            ))
            or 0
        )
        summary.append({"membership_id": str(member.id), "role": member.role.value, "open_conversations": open_count})
    summary.sort(key=lambda item: item["open_conversations"])
    return summary
