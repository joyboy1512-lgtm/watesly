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
    evaluate_knowledge_quality,
    export_knowledge_csv,
    generate_article_from_messages,
    get_agent_settings,
    import_knowledge_csv,
    increment_article_usage,
    list_knowledge_articles,
    list_knowledge_categories,
    record_article_feedback,
    search_knowledge_articles,
    serialize_agent_settings,
    suggest_smart_reply,
    update_agent_settings,
)

router = APIRouter()


def _article_response(item: KnowledgeArticle) -> KnowledgeArticleResponse:
    return KnowledgeArticleResponse(
        id=item.id,
        title=item.title,
        body=item.body,
        category=item.category,
        keywords=item.keywords,
        channel_id=getattr(item, "channel_id", None),
        is_active=item.is_active,
        sort_order=item.sort_order,
        usage_count=item.usage_count or 0,
        helpful_count=int(getattr(item, "helpful_count", 0) or 0),
        dismiss_count=int(getattr(item, "dismiss_count", 0) or 0),
        language=item.language,
    )


class AgentSettingsUpdate(BaseModel):
    default_mode: str | None = Field(default=None, pattern=r"^(kb_first|catalog_first|combined|local)$")
    tone: str | None = Field(default=None, pattern=r"^(friendly|formal|concise)$")
    language: str | None = Field(default=None, max_length=10)
    agent_enabled: bool | None = None
    local_engine_enabled: bool | None = None
    llm_enabled: bool | None = None
    auto_kb_on_inbound: bool | None = None
    auto_reply_on_inbound: bool | None = None
    llm_system_prompt: str | None = None
    auto_reply_outside_hours: bool | None = None
    business_hours_json: dict | None = None
    outside_hours_message: str | None = None
    llm_api_key: str | None = None
    clear_llm_api_key: bool | None = None
    llm_api_base_url: str | None = None
    llm_model: str | None = None
    llm_image_model: str | None = None
    escalation_keywords: list[str] | None = None
    clarify_max_rounds: int | None = Field(default=None, ge=1, le=10)


def _agent_settings_payload(item) -> dict:
    return serialize_agent_settings(item)


class GenerateFromConversationRequest(BaseModel):
    conversation_id: UUID
    title: str | None = None


class CopilotRequest(BaseModel):
    conversation_id: UUID


@router.get("", response_model=list[KnowledgeArticleResponse])
async def get_knowledge_articles(
    include_inactive: bool = Query(False),
    category: str | None = Query(None),
    channel_id: UUID | None = Query(None),
    unassigned_only: bool = Query(False),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    items = await list_knowledge_articles(
        db,
        context.account_id,
        active_only=not include_inactive,
        category=category,
        channel_id=channel_id,
        strict_channel=bool(channel_id) and not unassigned_only,
        unassigned_only=unassigned_only,
    )
    return [_article_response(item) for item in items]


@router.get("/search")
async def search_knowledge(
    q: str = Query(min_length=1),
    limit: int = Query(20, ge=1, le=100),
    channel_id: UUID | None = Query(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    items = await search_knowledge_articles(
        db,
        context.account_id,
        q,
        limit=limit,
        channel_id=channel_id,
        strict_channel=True,
    )
    return [
        {
            "id": str(item.id),
            "title": item.title,
            "body": item.body[:300],
            "category": item.category,
            "keywords": item.keywords,
            "channel_id": str(item.channel_id) if item.channel_id else None,
            "usage_count": item.usage_count,
        }
        for item in items
    ]


@router.get("/categories")
async def get_categories(
    channel_id: UUID | None = Query(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await list_knowledge_categories(
        db,
        context.account_id,
        channel_id=channel_id,
        strict_channel=bool(channel_id),
    )


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
    channel_id: UUID | None = Query(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_ops import get_effective_agent_settings

    if channel_id is not None:
        return await get_effective_agent_settings(
            db, account_id=context.account_id, channel_id=channel_id
        )
    item = await get_agent_settings(db, context.account_id)
    payload = _agent_settings_payload(item)
    from app.services.ai_ops import compute_reply_mode

    payload["account_agent_enabled"] = bool(payload.get("agent_enabled", True))
    payload["reply_mode"] = compute_reply_mode(payload)
    return payload


@router.patch("/agent-settings")
async def patch_settings(
    payload: AgentSettingsUpdate,
    channel_id: UUID | None = Query(None),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_ops import (
        compute_reply_mode,
        get_effective_agent_settings,
        update_account_kill_switch,
        update_channel_settings,
    )

    data = payload.model_dump(exclude_unset=True)
    # Account-level kill switch (and account defaults when no channel)
    if channel_id is None:
        if set(data.keys()) == {"agent_enabled"}:
            item = await update_account_kill_switch(
                db, account_id=context.account_id, agent_enabled=bool(data["agent_enabled"])
            )
            out = _agent_settings_payload(item)
            out["account_agent_enabled"] = bool(out.get("agent_enabled", True))
            out["reply_mode"] = compute_reply_mode(out)
            return out
        item = await update_agent_settings(db, context.account_id, **data)
        out = _agent_settings_payload(item)
        out["account_agent_enabled"] = bool(out.get("agent_enabled", True))
        out["reply_mode"] = compute_reply_mode(out)
        return out

    # Channel-scoped overrides — require an explicit channel
    channel_fields = {
        key: value
        for key, value in data.items()
        if key
        in {
            "agent_enabled",
            "local_engine_enabled",
            "llm_enabled",
            "auto_kb_on_inbound",
            "auto_reply_on_inbound",
            "default_mode",
            "tone",
            "language",
            "auto_reply_outside_hours",
            "business_hours_json",
            "outside_hours_message",
            "escalation_keywords",
            "clarify_max_rounds",
        }
    }
    # LLM credentials stay account-level
    for key in (
        "llm_api_key",
        "clear_llm_api_key",
        "llm_api_base_url",
        "llm_model",
        "llm_image_model",
        "llm_system_prompt",
    ):
        if key in data:
            await update_agent_settings(db, context.account_id, **{key: data[key]})
    if channel_fields:
        return await update_channel_settings(
            db,
            account_id=context.account_id,
            channel_id=channel_id,
            fields=channel_fields,
        )
    return await get_effective_agent_settings(
        db, account_id=context.account_id, channel_id=channel_id
    )


@router.post("/ai/lab-turn")
async def post_ai_lab_turn(
    payload: dict,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_ops import run_lab_turn

    channel_id = payload.get("channel_id")
    query = str(payload.get("query") or "").strip()
    if not channel_id or not query:
        raise HTTPException(status_code=400, detail="channel_id and query required")
    dialogue_state = payload.get("dialogue_state")
    if dialogue_state is not None and not isinstance(dialogue_state, dict):
        dialogue_state = None
    return await run_lab_turn(
        db,
        account_id=context.account_id,
        channel_id=UUID(str(channel_id)),
        query=query,
        contact_name=str(payload.get("contact_name") or ""),
        dialogue_state=dialogue_state,
        dry_run=bool(payload.get("dry_run", True)),
    )


@router.get("/ai/activity")
async def get_ai_activity(
    channel_id: UUID | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_ops import list_ai_activity, serialize_activity

    rows = await list_ai_activity(
        db,
        account_id=context.account_id,
        channel_id=channel_id,
        source=source,
        limit=limit,
    )
    return [serialize_activity(row) for row in rows]


@router.get("/ai/metrics")
async def get_ai_metrics(
    channel_id: UUID | None = Query(None),
    days: int = Query(7, ge=1, le=90),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_ops import ai_activity_metrics

    return await ai_activity_metrics(
        db, account_id=context.account_id, channel_id=channel_id, days=days
    )


@router.get("/ai/template-drafts")
async def get_ai_template_drafts(
    channel_id: UUID = Query(...),
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_ops import list_template_drafts, serialize_template_draft

    rows = await list_template_drafts(db, account_id=context.account_id, channel_id=channel_id)
    return [serialize_template_draft(row) for row in rows]


@router.post("/ai/template-drafts")
async def post_ai_template_draft(
    payload: dict,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.ai_template_draft import AiTemplateDraft
    from app.services.ai_ops import internal_template_check, serialize_template_draft

    channel_id = payload.get("channel_id")
    draft = payload.get("draft") or {}
    if not channel_id or not isinstance(draft, dict):
        raise HTTPException(status_code=400, detail="channel_id and draft required")
    item = AiTemplateDraft(
        account_id=context.account_id,
        channel_id=UUID(str(channel_id)),
        whatsapp_account_id=UUID(str(payload["whatsapp_account_id"])) if payload.get("whatsapp_account_id") else None,
        status=str(payload.get("status") or "draft"),
        topic=payload.get("topic"),
        angle=payload.get("angle"),
        draft_json=draft,
        internal_check_json=internal_template_check(draft),
        notes=payload.get("notes"),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return serialize_template_draft(item)


@router.patch("/ai/template-drafts/{draft_id}")
async def patch_ai_template_draft(
    draft_id: UUID,
    payload: dict,
    context: AuthContext = Depends(require_permissions(Permission.TEMPLATES_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.ai_template_draft import AiTemplateDraft
    from app.services.ai_ops import internal_template_check, serialize_template_draft

    item = await db.get(AiTemplateDraft, draft_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Draft not found")
    if "status" in payload:
        item.status = str(payload["status"])
    if "draft" in payload and isinstance(payload["draft"], dict):
        item.draft_json = payload["draft"]
        item.internal_check_json = internal_template_check(payload["draft"])
    if "notes" in payload:
        item.notes = payload.get("notes")
    if "angle" in payload:
        item.angle = payload.get("angle")
    if "meta_status" in payload:
        item.meta_status = payload.get("meta_status")
    if "template_id" in payload and payload["template_id"]:
        item.template_id = UUID(str(payload["template_id"]))
    await db.commit()
    await db.refresh(item)
    return serialize_template_draft(item)


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
    return _article_response(item)


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
    channel_raw = payload.get("channel_id")
    channel_id = UUID(str(channel_raw)) if channel_raw else None
    dialogue_state = payload.get("dialogue_state")
    if dialogue_state is not None and not isinstance(dialogue_state, dict):
        dialogue_state = None
    return await suggest_smart_reply(
        db,
        account_id=context.account_id,
        query=str(payload.get("query") or ""),
        contact_name=str(payload.get("contact_name") or ""),
        mode=str(payload.get("mode") or "") or None,
        use_llm=payload.get("use_llm"),
        channel_id=channel_id,
        dialogue_state=dialogue_state,
        membership=context.membership,
    )


class EvaluateCase(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    expected_article_id: UUID | None = None
    expected_title: str | None = Field(default=None, max_length=200)


class EvaluateRequest(BaseModel):
    cases: list[EvaluateCase] = Field(min_length=1, max_length=100)


class ArticleFeedbackRequest(BaseModel):
    helpful: bool


@router.post("/evaluate")
async def post_evaluate_knowledge(
    payload: EvaluateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await evaluate_knowledge_quality(
        db,
        context.account_id,
        [case.model_dump(mode="json") for case in payload.cases],
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


class KnowledgeBulkRequest(BaseModel):
    article_ids: list[UUID] = Field(min_length=1)


@router.post("/bulk-archive")
async def post_bulk_archive_knowledge(
    payload: KnowledgeBulkRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    rows = list(
        (
            await db.execute(
                select(KnowledgeArticle).where(
                    KnowledgeArticle.account_id == context.account_id,
                    KnowledgeArticle.id.in_(payload.article_ids),
                )
            )
        ).scalars()
    )
    succeeded = 0
    for item in rows:
        if item.is_active:
            item.is_active = False
            succeeded += 1
    await db.commit()
    return {"succeeded": succeeded, "failed": max(0, len(payload.article_ids) - len(rows))}


@router.post("/bulk-delete")
async def post_bulk_delete_knowledge(
    payload: KnowledgeBulkRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    rows = list(
        (
            await db.execute(
                select(KnowledgeArticle).where(
                    KnowledgeArticle.account_id == context.account_id,
                    KnowledgeArticle.id.in_(payload.article_ids),
                )
            )
        ).scalars()
    )
    for item in rows:
        await db.delete(item)
    await db.commit()
    return {"succeeded": len(rows), "failed": max(0, len(payload.article_ids) - len(rows))}


@router.get("/{article_id}", response_model=KnowledgeArticleResponse)
async def get_knowledge_article(
    article_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    return _article_response(item)


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
    return _article_response(item)


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


@router.post("/{article_id}/feedback")
async def post_article_feedback(
    article_id: UUID,
    payload: ArticleFeedbackRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    updated = await record_article_feedback(db, item, helpful=payload.helpful)
    return _article_response(updated)


@router.delete("/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_article(
    article_id: UUID,
    permanent: bool = Query(False),
    context: AuthContext = Depends(require_permissions(Permission.CONTACTS_EDIT, write=True)),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(KnowledgeArticle, article_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="Article not found")
    if permanent:
        await db.delete(item)
    else:
        item.is_active = False
    await db.commit()
