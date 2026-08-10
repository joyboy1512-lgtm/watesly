from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.inbox_tools import (
    ConversationTagRequest,
    NoteCreateRequest,
    NoteResponse,
    QuickReplyCreateRequest,
    QuickReplyFromConversationRequest,
    QuickReplyImportRequest,
    QuickReplyResponse,
    QuickReplySeedRequest,
    QuickReplySuggestRequest,
    QuickReplyUpdateRequest,
    TagCreateRequest,
    TagResponse,
)
from app.services.inbox_tools import (
    add_tag_to_conversation,
    create_note,
    create_quick_reply,
    create_tag,
    list_notes,
    list_conversation_tags,
    list_quick_replies,
    list_tags,
    remove_tag_from_conversation,
)
from app.services.quick_replies import (
    archive_quick_reply,
    create_from_conversation,
    export_quick_replies_csv,
    import_quick_replies_csv,
    increment_quick_reply_usage,
    list_quick_reply_categories,
    quick_replies_report,
    seed_starter_library,
    suggest_quick_replies,
    update_quick_reply,
)

router = APIRouter()


@router.get("/tags", response_model=list[TagResponse])
async def get_tags(
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_tags(db, context.account_id, membership=context.membership)


@router.post("/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def post_tag(
    payload: TagCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_tag(db, context.account_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid organization") from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Tag already exists") from exc


@router.post("/conversations/{conversation_id}/tags", status_code=status.HTTP_204_NO_CONTENT)
async def post_conversation_tag(
    conversation_id: UUID,
    payload: ConversationTagRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        await add_tag_to_conversation(db, context.account_id, conversation_id, payload.tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@router.delete("/conversations/{conversation_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation_tag(
    conversation_id: UUID,
    tag_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        await remove_tag_from_conversation(db, context.account_id, conversation_id, tag_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc
    return Response(status_code=204)


@router.get("/conversations/{conversation_id}/notes", response_model=list[NoteResponse])
async def get_notes(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_notes(db, context.account_id, conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc


@router.post("/conversations/{conversation_id}/notes", response_model=NoteResponse)
async def post_note(
    conversation_id: UUID,
    payload: NoteCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_note(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            user_id=context.user.id,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc


@router.get("/quick-replies", response_model=list[QuickReplyResponse])
async def get_quick_replies(
    organization_id: UUID | None = Query(None),
    channel_id: UUID | None = Query(None),
    category: str | None = Query(None),
    q: str | None = Query(None),
    include_inactive: bool = Query(False),
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_quick_replies(
        db,
        context.account_id,
        membership=context.membership,
        organization_id=organization_id,
        channel_id=channel_id,
        category=category,
        q=q,
        active_only=not include_inactive,
    )


@router.get("/quick-replies/categories")
async def get_quick_reply_categories(
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_quick_reply_categories(db, context.account_id)


@router.get("/quick-replies/export")
async def export_quick_replies(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    content = await export_quick_replies_csv(db, context.account_id)
    return PlainTextResponse(
        content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=quick-replies-export.csv"},
    )


@router.get("/quick-replies/analytics")
async def get_quick_replies_analytics(
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.REPORTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await quick_replies_report(db, account_id=context.account_id, limit=limit)


@router.post("/quick-replies/suggest", response_model=list[QuickReplyResponse])
async def post_quick_reply_suggest(
    payload: QuickReplySuggestRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await suggest_quick_replies(
        db,
        context.account_id,
        query=payload.query,
        organization_id=payload.organization_id,
        channel_id=payload.channel_id,
        limit=payload.limit,
    )


@router.post("/quick-replies/import")
async def post_quick_reply_import(
    payload: QuickReplyImportRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await import_quick_replies_csv(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            organization_id=payload.organization_id,
            content=payload.csv_content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/quick-replies/seed")
async def post_quick_reply_seed(
    payload: QuickReplySeedRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await seed_starter_library(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            organization_id=payload.organization_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/quick-replies/from-conversation", response_model=QuickReplyResponse, status_code=status.HTTP_201_CREATED)
async def post_quick_reply_from_conversation(
    payload: QuickReplyFromConversationRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_from_conversation(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            payload=payload,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "NO_OUTBOUND_MESSAGE":
            raise HTTPException(status_code=400, detail="No outbound message to save") from exc
        if detail == "CONVERSATION_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Conversation not found") from exc
        raise HTTPException(status_code=400, detail=detail) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Shortcut already exists") from exc


@router.post("/quick-replies", response_model=QuickReplyResponse, status_code=status.HTTP_201_CREATED)
async def post_quick_reply(
    payload: QuickReplyCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await create_quick_reply(
            db,
            account_id=context.account_id,
            user_id=context.user.id,
            payload=payload,
            membership=context.membership,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid organization") from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Shortcut already exists") from exc


@router.patch("/quick-replies/{reply_id}", response_model=QuickReplyResponse)
async def patch_quick_reply(
    reply_id: UUID,
    payload: QuickReplyUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await update_quick_reply(
            db,
            account_id=context.account_id,
            reply_id=reply_id,
            payload=payload,
            membership=context.membership,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "NOT_FOUND":
            raise HTTPException(status_code=404, detail="Quick reply not found") from exc
        raise HTTPException(status_code=400, detail="Invalid organization") from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Shortcut already exists") from exc


@router.delete("/quick-replies/{reply_id}", response_model=QuickReplyResponse)
async def delete_quick_reply(
    reply_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await archive_quick_reply(
            db,
            account_id=context.account_id,
            reply_id=reply_id,
            membership=context.membership,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Quick reply not found") from exc


@router.post("/quick-replies/{reply_id}/usage", response_model=QuickReplyResponse)
async def post_quick_reply_usage(
    reply_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await increment_quick_reply_usage(db, account_id=context.account_id, reply_id=reply_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Quick reply not found") from exc


@router.get("/conversations/{conversation_id}/tags", response_model=list[TagResponse])
async def get_conversation_tags(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await list_conversation_tags(db, context.account_id, conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Conversation not found") from exc
