from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.assignment import (
    AssignmentRuleCreateRequest,
    AssignmentRuleResponse,
    AssignmentRuleUpdateRequest,
    TeamCreateRequest,
    TeamResponse,
    TeamUpdateMembersRequest,
    TeamUpdateRequest,
)
from app.services.assignments import (
    create_assignment_rule,
    create_team,
    delete_assignment_rule,
    delete_team,
    list_assignment_rules,
    list_teams,
    update_assignment_rule,
    update_team,
    update_team_members,
)

router = APIRouter()


def _team_response(team, membership_ids: list) -> TeamResponse:
    return TeamResponse(
        id=team.id,
        organization_id=team.organization_id,
        name=team.name,
        description=team.description,
        membership_ids=membership_ids,
    )


@router.get("/teams", response_model=list[TeamResponse])
async def get_teams(
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = await list_teams(db, account_id=context.account_id)
    return [_team_response(team, membership_ids) for team, membership_ids in rows]


@router.post("/teams", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def post_team(
    payload: TeamCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        team = await create_team(db, account_id=context.account_id, payload=payload)
    except ValueError as exc:
        messages = {
            "INVALID_ORGANIZATION": (400, "Invalid organization"),
            "INVALID_MEMBERSHIP": (400, "Invalid team member"),
            "MEMBER_OUT_OF_BRANCH": (400, "Team members must belong to the selected branch"),
        }
        code, detail = messages.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=code, detail=detail) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Team name already exists") from exc

    return _team_response(team, payload.membership_ids)


@router.patch("/teams/{team_id}", response_model=TeamResponse)
async def patch_team(
    team_id: UUID,
    payload: TeamUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        team, membership_ids = await update_team(
            db,
            account_id=context.account_id,
            team_id=team_id,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "TEAM_NOT_FOUND": (404, "Team not found"),
            "INVALID_MEMBERSHIP": (400, "Invalid team member"),
            "MEMBER_OUT_OF_BRANCH": (400, "Team members must belong to the team's branch"),
        }
        code, detail = messages.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=code, detail=detail) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Team name already exists") from exc

    return _team_response(team, membership_ids)


@router.put("/teams/{team_id}/members", response_model=TeamResponse)
async def put_team_members(
    team_id: UUID,
    payload: TeamUpdateMembersRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        team, membership_ids = await update_team_members(
            db,
            account_id=context.account_id,
            team_id=team_id,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "TEAM_NOT_FOUND": (404, "Team not found"),
            "INVALID_MEMBERSHIP": (400, "Invalid team member"),
            "MEMBER_OUT_OF_BRANCH": (400, "Team members must belong to the team's branch"),
        }
        code, detail = messages.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=code, detail=detail) from exc

    return _team_response(team, membership_ids)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team(
    team_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_team(db, account_id=context.account_id, team_id=team_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Team not found") from exc


@router.get("/rules", response_model=list[AssignmentRuleResponse])
async def get_rules(
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_assignment_rules(db, account_id=context.account_id)


@router.post("/rules", response_model=AssignmentRuleResponse, status_code=status.HTTP_201_CREATED)
async def post_rule(
    payload: AssignmentRuleCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_assignment_rule(
            db, account_id=context.account_id, payload=payload
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/rules/{rule_id}", response_model=AssignmentRuleResponse)
async def patch_rule(
    rule_id: UUID,
    payload: AssignmentRuleUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_assignment_rule(
            db,
            account_id=context.account_id,
            rule_id=rule_id,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Rule not found") from exc


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_rule(
    rule_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_ASSIGN, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        await delete_assignment_rule(db, account_id=context.account_id, rule_id=rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Rule not found") from exc
