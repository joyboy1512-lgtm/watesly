from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.models.knowledge_article import KnowledgeArticle
from app.schemas.growth import (
    KnowledgeArticleCreate,
    KnowledgeArticleResponse,
    KnowledgeArticleUpdate,
)
from app.services.knowledge_base import (
    conversation_copilot,
    export_knowledge_csv,
    generate_article_from_messages,
    get_agent_settings,
    import_knowledge_csv,
    increment_article_usage,
    list_knowledge_articles,
    list_knowledge_categories,
    search_knowledge_articles,
    suggest_smart_reply,
    update_agent_settings,
)
from app.services.llm_client import llm_available

router = APIRouter()


class AgentSettingsUpdate(BaseModel):
    default_mode: str | None = Field(default=None, pattern=r"^(kb_first|catalog_first|combined|local)$")
    tone: str | None = Field(default=None, pattern=r"^(friendly|formal|concise)$")
    language: str | None = Field(default=None, max_length=10)
    llm_enabled: bool | None = None
    auto_kb_on_inbound: bool | None = None
    llm_system_prompt: str | None = None


class GenerateFromConversationRequest(BaseModel):
    conversation_id: UUID
    title: str | None = None


class CopilotRequest(BaseModel):
    conversation_id: UUID


@router.get("", response_model=list[KnowledgeArticleResponse])
async def get_knowledge_articles(
    include_inactive: bool = Query(False),
    category: str | None = Query(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    items = await list_knowledge_articles(
        db, context.account_id, active_only=not include_inactive, category=category
    )
    return [
        KnowledgeArticleResponse(
            id=item.id,
            title=item.title,
            body=item.body,
            category=item.category,
            keywords=item.keywords,
            is_active=item.is_active,
            sort_order=item.sort_order,
            usage_count=item.usage_count,
            language=item.language,
        )
        for item in items
    ]


@router.get("/search")
async def search_knowledge(
    q: str = Query(min_length=1),
    limit: int = Query(20, ge=1, le=100),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    items = await search_knowledge_articles(db, context.account_id, q, limit=limit)
    return [
        {
            "id": str(item.id),
            "title": item.title,
            "body": item.body[:300],
            "category": item.category,
            "keywords": item.keywords,
            "usage_count": item.usage_count,
        }
        for item in items
    ]


@router.get("/categories")
async def get_categories(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_knowledge_categories(db, context.account_id)


@router.get("/export")
async def export_knowledge(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    content = await export_knowledge_csv(db, context.account_id)
    return PlainTextResponse(
        content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=knowledge-export.csv"},
    )


@router.post("/import")
async def import_knowledge(
    file: UploadFile = File(...),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    raw = (await file.read()).decode("utf-8-sig")
    return await import_knowledge_csv(db, context.account_id, raw)


@router.get("/agent-settings")
async def get_settings(
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    item = await get_agent_settings(db, context.account_id)
    return {
        "default_mode": item.default_mode,
        "tone": item.tone,
        "language": item.language,
        "llm_enabled": item.llm_enabled,
        "auto_kb_on_inbound": item.auto_kb_on_inbound,
        "llm_system_prompt": item.llm_system_prompt,
        "llm_available": llm_available(),
    }


@router.patch("/agent-settings")
async def patch_settings(
    payload: AgentSettingsUpdate,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await update_agent_settings(
        db, context.account_id, **payload.model_dump(exclude_unset=True)
    )
    return {
        "default_mode": item.default_mode,
        "tone": item.tone,
        "language": item.language,
        "llm_enabled": item.llm_enabled,
        "auto_kb_on_inbound": item.auto_kb_on_inbound,
        "llm_system_prompt": item.llm_system_prompt,
        "llm_available": llm_available(),
    }


@router.post("", response_model=KnowledgeArticleResponse, status_code=status.HTTP_201_CREATED)
async def post_knowledge_article(
    payload: KnowledgeArticleCreate,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = KnowledgeArticle(account_id=context.account_id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return KnowledgeArticleResponse(
        id=item.id,
        title=item.title,
        body=item.body,
        category=item.category,
        keywords=item.keywords,
        is_active=item.is_active,
        sort_order=item.sort_order,
        usage_count=item.usage_count,
        language=item.language,
    )


@router.post("/generate-from-conversation")
async def post_generate_from_conversation(
    payload: GenerateFromConversationRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.message import Message
    from app.services.conversations import get_conversation_for_send

    try:
        conversation = await get_conversation_for_send(
            db,
            account_id=context.account_id,
            conversation_id=payload.conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = 403 if str(exc) == "CONVERSATION_FORBIDDEN" else 404
        raise HTTPException(status_code=code, detail="Conversation not available") from exc

    rows = list(
        (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.asc())
                .limit(20)
            )
        ).scalars().all()
    )
    texts = [row.text_body for row in rows if row.text_body]
    try:
        draft = await generate_article_from_messages(
            db,
            account_id=context.account_id,
            messages=texts,
            title_hint=payload.title or "",
        )
    except ValueError as exc:
        if str(exc) == "NO_MESSAGES":
            raise HTTPException(status_code=400, detail="No text messages in conversation") from exc
        raise
    return draft


@router.post("/suggest-reply")
async def post_knowledge_suggest_reply(
    payload: dict,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await suggest_smart_reply(
        db,
        account_id=context.account_id,
        query=str(payload.get("query") or ""),
        contact_name=str(payload.get("contact_name") or ""),
        mode=str(payload.get("mode") or "") or None,
        use_llm=payload.get("use_llm"),
    )


@router.post("/copilot")
async def post_copilot(
    payload: CopilotRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.contact import Contact
    from app.models.message import Message
    from app.services.conversations import get_conversation_for_send

    try:
        conversation = await get_conversation_for_send(
            db,
            account_id=context.account_id,
            conversation_id=payload.conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = 403 if str(exc) == "CONVERSATION_FORBIDDEN" else 404
        raise HTTPException(status_code=code, detail="Conversation not available") from exc

    contact = await db.get(Contact, conversation.contact_id)
    rows = list(
        (
            await db.execute(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.asc())
                .limit(30)
            )
        ).scalars().all()
    )
    texts = [row.text_body for row in rows if row.text_body]
    return await conversation_copilot(
        db,
        account_id=context.account_id,
        messages=texts,
        contact_name=contact.display_name if contact else "",
    )


@router.get("/{article_id}", response_model=KnowledgeArticleResponse)
async def get_knowledge_article(
    article_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    return KnowledgeArticleResponse(
        id=item.id,
        title=item.title,
        body=item.body,
        category=item.category,
        keywords=item.keywords,
        is_active=item.is_active,
        sort_order=item.sort_order,
        usage_count=item.usage_count,
        language=item.language,
    )


@router.patch("/{article_id}", response_model=KnowledgeArticleResponse)
async def patch_knowledge_article(
    article_id: UUID,
    payload: KnowledgeArticleUpdate,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return KnowledgeArticleResponse(
        id=item.id,
        title=item.title,
        body=item.body,
        category=item.category,
        keywords=item.keywords,
        is_active=item.is_active,
        sort_order=item.sort_order,
        usage_count=item.usage_count,
        language=item.language,
    )


@router.post("/{article_id}/usage", status_code=204)
async def post_article_usage(
    article_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    await increment_article_usage(db, item)


@router.delete("/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_article(
    article_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    item.is_active = False
    await db.commit()
