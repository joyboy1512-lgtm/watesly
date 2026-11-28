from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.services.web_chat import (
    activate_web_chat_channel,
    ingest_web_chat_inbound,
    list_web_chat_messages_for_visitor,
)

router = APIRouter()


class WebChatActivateResponse(BaseModel):
    channel_id: UUID
    widget_token: str
    status: str
    public_ingest_path: str
    embed_hint: str


class WebChatInboundRequest(BaseModel):
    visitor_id: str = Field(min_length=2, max_length=120)
    text: str = Field(min_length=1, max_length=4000)
    display_name: str | None = Field(default=None, max_length=160)


@router.post("/channels/{channel_id}/activate", response_model=WebChatActivateResponse)
async def post_activate_web_chat(
    channel_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        channel = await activate_web_chat_channel(
            db, account_id=context.account_id, channel_id=channel_id
        )
    except ValueError as exc:
        messages = {
            "INVALID_CHANNEL": (400, "Channel is invalid"),
            "CHANNEL_NOT_WEB_CHAT": (400, "Selected channel is not Web Chat"),
        }
        code, detail = messages.get(str(exc), (400, "تعذر تفعيل Web Chat"))
        raise HTTPException(status_code=code, detail=detail) from exc
    token = channel.external_id or ""
    return WebChatActivateResponse(
        channel_id=channel.id,
        widget_token=token,
        status=channel.status,
        public_ingest_path=f"/api/v1/web-chat/{token}/messages",
        embed_hint="أرسل POST JSON: {visitor_id, text} إلى المسار العام أعلاه، ثم استطلع الرسائل بـ GET.",
    )


@router.post("/{widget_token}/messages", include_in_schema=True)
async def post_public_web_chat_message(
    widget_token: str,
    payload: WebChatInboundRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await ingest_web_chat_inbound(
            db,
            token=widget_token,
            visitor_id=payload.visitor_id,
            text=payload.text,
            display_name=payload.display_name,
        )
    except ValueError as exc:
        messages = {
            "WEB_CHAT_NOT_FOUND": (404, "Web Chat channel not found"),
            "EMPTY_TEXT": (400, "Text is required"),
            "INVALID_VISITOR": (400, "visitor_id is required"),
        }
        code, detail = messages.get(str(exc), (400, str(exc)))
        raise HTTPException(status_code=code, detail=detail) from exc
    return {"status": "accepted", **result}


@router.get("/{widget_token}/messages", include_in_schema=True)
async def get_public_web_chat_messages(
    widget_token: str,
    visitor_id: str = Query(..., min_length=2, max_length=120),
    after: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        rows = await list_web_chat_messages_for_visitor(
            db, token=widget_token, visitor_id=visitor_id, after=after
        )
    except ValueError as exc:
        if str(exc) == "WEB_CHAT_NOT_FOUND":
            raise HTTPException(status_code=404, detail="Web Chat channel not found") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"messages": rows}
