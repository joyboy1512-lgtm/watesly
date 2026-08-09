from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assignment_rule import AssignmentRule, AssignmentStrategy
from app.models.conversation import Conversation, ConversationStatus
from app.models.membership import Membership, MembershipStatus
from app.models.organization import Organization
from app.models.team import Team
from app.models.team_member import TeamMember
from app.models.organization_membership import OrganizationMembership
from app.schemas.assignment import (
    AssignmentRuleCreateRequest,
    AssignmentRuleUpdateRequest,
    TeamCreateRequest,
    TeamUpdateMembersRequest,
    TeamUpdateRequest,
)


async def _validate_memberships(
    db: AsyncSession,
    *,
    account_id: UUID,
    membership_ids: list[UUID],
) -> set[UUID]:
    if not membership_ids:
        return set()
    result = await db.execute(
        select(Membership.id).where(
            Membership.account_id == account_id,
            Membership.status == MembershipStatus.ACTIVE,
            Membership.id.in_(membership_ids),
        )
    )
    valid = set(result.scalars().all())
    if valid != set(membership_ids):
        raise ValueError("INVALID_MEMBERSHIP")
    return valid


async def _validate_memberships_in_organization(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    membership_ids: list[UUID],
) -> set[UUID]:
    valid = await _validate_memberships(
        db,
        account_id=account_id,
        membership_ids=membership_ids,
    )
    if not valid:
        return valid
    result = await db.execute(
        select(OrganizationMembership.membership_id).where(
            OrganizationMembership.membership_id.in_(valid),
            OrganizationMembership.organization_id == organization_id,
        )
    )
    in_org = set(result.scalars().all())
    if in_org != valid:
        raise ValueError("MEMBER_OUT_OF_BRANCH")
    return valid


async def create_team(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: TeamCreateRequest,
) -> Team:
    organization = await db.get(Organization, payload.organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")

    valid_memberships = await _validate_memberships_in_organization(
        db,
        account_id=account_id,
        organization_id=payload.organization_id,
        membership_ids=payload.membership_ids,
    )

    team = Team(
        account_id=account_id,
        organization_id=payload.organization_id,
        name=payload.name,
        description=payload.description,
    )
    db.add(team)
    await db.flush()

    db.add_all(
        TeamMember(team_id=team.id, membership_id=membership_id)
        for membership_id in valid_memberships
    )
    await db.commit()
    await db.refresh(team)
    return team


async def list_teams(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> list[tuple[Team, list[UUID]]]:
    result = await db.execute(
        select(Team)
        .where(Team.account_id == account_id)
        .order_by(Team.name.asc())
    )
    rows = []
    for team in result.scalars().all():
        member_result = await db.execute(
            select(TeamMember.membership_id).where(TeamMember.team_id == team.id)
        )
        rows.append((team, list(member_result.scalars().all())))
    return rows


async def update_team_members(
    db: AsyncSession,
    *,
    account_id: UUID,
    team_id: UUID,
    payload: TeamUpdateMembersRequest,
) -> tuple[Team, list[UUID]]:
    from sqlalchemy import delete

    team = await db.get(Team, team_id)
    if team is None or team.account_id != account_id:
        raise ValueError("TEAM_NOT_FOUND")

    valid = await _validate_memberships_in_organization(
        db,
        account_id=account_id,
        organization_id=team.organization_id,
        membership_ids=payload.membership_ids,
    )
    await db.execute(delete(TeamMember).where(TeamMember.team_id == team.id))
    db.add_all(
        TeamMember(team_id=team.id, membership_id=membership_id)
        for membership_id in valid
    )
    await db.commit()
    return team, list(valid)


async def update_team(
    db: AsyncSession,
    *,
    account_id: UUID,
    team_id: UUID,
    payload: TeamUpdateRequest,
) -> tuple[Team, list[UUID]]:
    from sqlalchemy import delete

    team = await db.get(Team, team_id)
    if team is None or team.account_id != account_id:
        raise ValueError("TEAM_NOT_FOUND")

    if payload.name is not None:
        team.name = payload.name.strip()
    if payload.description is not None:
        team.description = payload.description

    membership_ids: list[UUID]
    if payload.membership_ids is not None:
        valid = await _validate_memberships_in_organization(
            db,
            account_id=account_id,
            organization_id=team.organization_id,
            membership_ids=payload.membership_ids,
        )
        await db.execute(delete(TeamMember).where(TeamMember.team_id == team.id))
        db.add_all(
            TeamMember(team_id=team.id, membership_id=membership_id)
            for membership_id in valid
        )
        membership_ids = list(valid)
    else:
        member_result = await db.execute(
            select(TeamMember.membership_id).where(TeamMember.team_id == team.id)
        )
        membership_ids = list(member_result.scalars().all())

    await db.commit()
    await db.refresh(team)
    return team, membership_ids


async def delete_team(db: AsyncSession, *, account_id: UUID, team_id: UUID) -> None:
    team = await db.get(Team, team_id)
    if team is None or team.account_id != account_id:
        raise ValueError("TEAM_NOT_FOUND")
    await db.delete(team)
    await db.commit()


async def create_assignment_rule(
    db: AsyncSession,
    *,
    account_id: UUID,
    payload: AssignmentRuleCreateRequest,
) -> AssignmentRule:
    team = await db.get(Team, payload.team_id)
    if (
        team is None
        or team.account_id != account_id
        or team.organization_id != payload.organization_id
    ):
        raise ValueError("INVALID_TEAM")

    rule = AssignmentRule(account_id=account_id, **payload.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


async def list_assignment_rules(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> list[AssignmentRule]:
    result = await db.execute(
        select(AssignmentRule)
        .where(AssignmentRule.account_id == account_id)
        .order_by(AssignmentRule.priority.asc(), AssignmentRule.created_at.asc())
    )
    return list(result.scalars().all())


async def update_assignment_rule(
    db: AsyncSession,
    *,
    account_id: UUID,
    rule_id: UUID,
    payload: AssignmentRuleUpdateRequest,
) -> AssignmentRule:
    rule = await db.get(AssignmentRule, rule_id)
    if rule is None or rule.account_id != account_id:
        raise ValueError("RULE_NOT_FOUND")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        rule.name = updates["name"]
    if "strategy" in updates:
        rule.strategy = updates["strategy"]
    if "priority" in updates:
        rule.priority = updates["priority"]
    if "is_active" in updates:
        rule.is_active = updates["is_active"]
    if "channel_id" in updates:
        rule.channel_id = updates["channel_id"]

    await db.commit()
    await db.refresh(rule)
    return rule


async def delete_assignment_rule(
    db: AsyncSession,
    *,
    account_id: UUID,
    rule_id: UUID,
) -> None:
    rule = await db.get(AssignmentRule, rule_id)
    if rule is None or rule.account_id != account_id:
        raise ValueError("RULE_NOT_FOUND")
    await db.delete(rule)
    await db.commit()


async def auto_assign_conversation(
    db: AsyncSession,
    *,
    conversation: Conversation,
) -> Membership | None:
    rule_result = await db.execute(
        select(AssignmentRule).where(
            AssignmentRule.account_id == conversation.account_id,
            AssignmentRule.organization_id == conversation.organization_id,
            AssignmentRule.is_active.is_(True),
            (AssignmentRule.channel_id.is_(None)) | (AssignmentRule.channel_id == conversation.channel_id),
        ).order_by(AssignmentRule.priority.asc(), AssignmentRule.created_at.asc())
    )
    rule = rule_result.scalars().first()
    if rule is None:
        return None

    members_result = await db.execute(
        select(Membership)
        .join(TeamMember, TeamMember.membership_id == Membership.id)
        .where(
            TeamMember.team_id == rule.team_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
        .order_by(Membership.created_at.asc())
    )
    members = list(members_result.scalars().all())
    if not members:
        return None

    selected: Membership
    if rule.strategy == AssignmentStrategy.LEAST_OPEN:
        counts = []
        for member in members:
            open_count = await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == conversation.account_id,
                    Conversation.organization_id == conversation.organization_id,
                    Conversation.assigned_membership_id == member.id,
                    Conversation.status.in_(
                        [ConversationStatus.OPEN, ConversationStatus.PENDING]
                    ),
                )
            )
            counts.append((int(open_count or 0), member.created_at, member))
        selected = min(counts, key=lambda item: (item[0], item[1]))[2]
    else:
        member_ids = [member.id for member in members]
        if rule.last_assigned_membership_id in member_ids:
            index = member_ids.index(rule.last_assigned_membership_id)
            selected = members[(index + 1) % len(members)]
        else:
            selected = members[0]
        rule.last_assigned_membership_id = selected.id

    conversation.assigned_membership_id = selected.id
    return selected
