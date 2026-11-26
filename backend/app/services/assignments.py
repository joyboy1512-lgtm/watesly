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


async def _matching_rules(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    channel_id: UUID | None,
) -> list[AssignmentRule]:
    result = await db.execute(
        select(AssignmentRule)
        .where(
            AssignmentRule.account_id == account_id,
            AssignmentRule.organization_id == organization_id,
            AssignmentRule.is_active.is_(True),
            (AssignmentRule.channel_id.is_(None)) | (AssignmentRule.channel_id == channel_id),
        )
        .order_by(AssignmentRule.priority.asc(), AssignmentRule.created_at.asc())
    )
    return list(result.scalars().all())


async def _select_member_for_rule(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    rule: AssignmentRule,
    apply_round_robin_cursor: bool,
) -> tuple[Membership | None, list[dict], str | None]:
    """Pick a member for a rule. Returns (member, candidate_trace, skip_reason)."""
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
        return None, [], "لا يوجد موظفون نشطون في فريق القاعدة"

    candidates: list[dict] = []
    selected: Membership
    if rule.strategy == AssignmentStrategy.LEAST_OPEN:
        counts = []
        for member in members:
            open_count = await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == account_id,
                    Conversation.organization_id == organization_id,
                    Conversation.assigned_membership_id == member.id,
                    Conversation.status.in_(
                        [ConversationStatus.OPEN, ConversationStatus.PENDING]
                    ),
                )
            )
            load = int(open_count or 0)
            counts.append((load, member.created_at, member))
            candidates.append(
                {
                    "membership_id": str(member.id),
                    "open_conversations": load,
                    "selected": False,
                    "reason": f"حمل مفتوح: {load}",
                }
            )
        selected = min(counts, key=lambda item: (item[0], item[1]))[2]
        for row in candidates:
            if row["membership_id"] == str(selected.id):
                row["selected"] = True
                row["reason"] = f"أقل حمل مفتوح ({row['open_conversations']})"
    else:
        member_ids = [member.id for member in members]
        if rule.last_assigned_membership_id in member_ids:
            index = member_ids.index(rule.last_assigned_membership_id)
            selected = members[(index + 1) % len(members)]
        else:
            selected = members[0]
        if apply_round_robin_cursor:
            rule.last_assigned_membership_id = selected.id
        for member in members:
            candidates.append(
                {
                    "membership_id": str(member.id),
                    "open_conversations": None,
                    "selected": member.id == selected.id,
                    "reason": "التالي في round-robin" if member.id == selected.id else "مرشّح",
                }
            )
    return selected, candidates, None


async def auto_assign_conversation(
    db: AsyncSession,
    *,
    conversation: Conversation,
) -> Membership | None:
    rules = await _matching_rules(
        db,
        account_id=conversation.account_id,
        organization_id=conversation.organization_id,
        channel_id=conversation.channel_id,
    )
    if not rules:
        return None

    # First matching rule by priority wins; ties keep earliest created_at (already ordered).
    for rule in rules:
        selected, _candidates, skip = await _select_member_for_rule(
            db,
            account_id=conversation.account_id,
            organization_id=conversation.organization_id,
            rule=rule,
            apply_round_robin_cursor=True,
        )
        if selected is None:
            continue
        conversation.assigned_membership_id = selected.id
        return selected
    return None


async def simulate_assignment(
    db: AsyncSession,
    *,
    account_id: UUID,
    organization_id: UUID,
    channel_id: UUID | None = None,
    team_id: UUID | None = None,
) -> dict:
    """Dry-run routing without assigning a real conversation."""
    from app.models.user import User

    organization = await db.get(Organization, organization_id)
    if organization is None or organization.account_id != account_id:
        raise ValueError("INVALID_ORGANIZATION")

    waiting = int(
        (
            await db.scalar(
                select(func.count(Conversation.id)).where(
                    Conversation.account_id == account_id,
                    Conversation.organization_id == organization_id,
                    Conversation.assigned_membership_id.is_(None),
                    Conversation.status.in_([ConversationStatus.OPEN, ConversationStatus.PENDING]),
                    *([Conversation.channel_id == channel_id] if channel_id else []),
                )
            )
        )
        or 0
    )

    rules = await _matching_rules(
        db,
        account_id=account_id,
        organization_id=organization_id,
        channel_id=channel_id,
    )
    if team_id:
        rules = [rule for rule in rules if rule.team_id == team_id]

    considered: list[dict] = []
    winner = None
    selected_member = None
    candidates: list[dict] = []
    outcome = "no_rule"
    reason = "لا توجد قاعدة نشطة مطابقة للفرع والقناة"

    for index, rule in enumerate(rules):
        member, member_trace, skip = await _select_member_for_rule(
            db,
            account_id=account_id,
            organization_id=organization_id,
            rule=rule,
            apply_round_robin_cursor=False,
        )
        entry = {
            "rule_id": str(rule.id),
            "rule_name": rule.name,
            "priority": rule.priority,
            "strategy": rule.strategy.value if hasattr(rule.strategy, "value") else str(rule.strategy),
            "team_id": str(rule.team_id),
            "channel_id": str(rule.channel_id) if rule.channel_id else None,
            "skipped": member is None,
            "skip_reason": skip,
            "would_win": False,
        }
        if winner is None and member is not None:
            winner = rule
            selected_member = member
            candidates = member_trace
            entry["would_win"] = True
            outcome = "assigned"
            reason = (
                f"القاعدة ذات الأولوية {rule.priority} فازت"
                + (" — تعادل الأولوية يُحسم بأقدم قاعدة" if index > 0 and rules[0].priority == rule.priority else "")
            )
        elif winner is None and member is None:
            entry["skip_reason"] = skip or "لا يوجد موظف متاح"
        considered.append(entry)

    if winner is None and rules:
        outcome = "unassigned_queue"
        reason = (
            "وُجدت قواعد مطابقة لكن لا يوجد موظف نشط متاح؛ "
            f"تبقى المحادثة بانتظار التعيين ({waiting} محادثة حالياً بدون مسؤول)."
        )
    elif winner is None:
        outcome = "unassigned_queue"
        reason = (
            "لا توجد قاعدة مطابقة؛ المحادثة تدخل طابور الانتظار "
            f"({waiting} محادثة بانتظار التعيين لهذا النطاق)."
        )

    assignee_name = None
    assignee_id = None
    if selected_member is not None:
        assignee_id = str(selected_member.id)
        user = await db.get(User, selected_member.user_id)
        assignee_name = user.full_name if user else None

    winning_rule = next((item for item in considered if item["would_win"]), None)
    return {
        "dry_run": True,
        "organization_id": str(organization_id),
        "channel_id": str(channel_id) if channel_id else None,
        "waiting_conversations": waiting,
        "outcome": outcome,
        "reason": reason,
        "winning_rule": winning_rule,
        "expected_membership_id": assignee_id,
        "expected_member_name": assignee_name,
        "candidates": candidates,
        "considered_rules": considered,
        "tie_break_rule": "أقل priority أولاً، ثم أقدم created_at",
        "absence_behavior": "عند غياب كل الموظفين تبقى المحادثة بدون مسؤول في طابور الانتظار",
    }
