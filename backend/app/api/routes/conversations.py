from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.conversation import (
    ConversationResponse,
    ConversationUpdateRequest,
    ConversationSendTextRequest,
    ConversationSendTemplateRequest,
    ConversationSendProductRequest,
    ConversationSendProductListRequest,
    ConversationRenderTextRequest,
    ConversationContextResponse,
)
from app.schemas.growth import ConversationRatingRequest
from app.services.whatsapp_window import (
    compute_service_window,
    get_last_inbound_by_conversation,
    get_last_inbound_for_conversation,
)
from app.realtime.event_bus import publish_event
from app.schemas.message import MessageResponse
from app.services.conversations import (
    build_conversation_response,
    list_conversations,
    list_messages,
    update_conversation,
    get_conversation_for_send,
)

router = APIRouter()


@router.get("", response_model=list[ConversationResponse])
async def get_conversations(
    limit: int = Query(100, ge=1, le=200),
    starred: bool = Query(False),
    archived: bool = Query(False),
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationResponse]:
    rows = await list_conversations(
        db,
        account_id=context.account_id,
        membership=context.membership,
        limit=limit,
        include_archived=archived,
        archived_only=archived,
        starred_only=starred,
    )
    conversation_ids = [row[0].id for row in rows]
    last_inbound_map = await get_last_inbound_by_conversation(db, conversation_ids)
    return [
        build_conversation_response(
            conversation=conversation,
            contact=contact,
            message=message,
            unread=unread,
            last_inbound_at=last_inbound_map.get(conversation.id),
        )
        for conversation, contact, message, unread in rows
    ]


@router.get("/{conversation_id}/messages", response_model=list[MessageResponse])
async def get_conversation_messages(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
) -> list[MessageResponse]:
    try:
        messages = await list_messages(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        detail = (
            "You cannot access this conversation"
            if str(exc) == "CONVERSATION_FORBIDDEN"
            else "Conversation not found"
        )
        raise HTTPException(status_code=403 if "FORBIDDEN" in str(exc) else 404, detail=detail) from exc

    from app.services.message_media import extract_message_media

    return [
        MessageResponse(
            id=item.id,
            conversation_id=item.conversation_id,
            direction=item.direction,
            type=item.type,
            from_address=item.from_address,
            to_address=item.to_address,
            text_body=item.text_body,
            status=item.status,
            created_at=item.created_at,
            **extract_message_media(item),
        )
        for item in messages
    ]


@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def patch_conversation(
    conversation_id: UUID,
    payload: ConversationUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    try:
        conversation = await update_conversation(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            actor_user_id=context.user.id,
            payload=payload,
        )
    except ValueError as exc:
        messages = {
            "CONVERSATION_NOT_FOUND": (404, "Conversation not found"),
            "INVALID_ASSIGNEE": (400, "Assigned employee is invalid"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to update conversation"))
        raise HTTPException(status_code=code, detail=detail) from exc

    from app.models.contact import Contact
    from app.models.message import Message

    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    latest_message = (
        await db.execute(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    last_inbound = await get_last_inbound_for_conversation(db, conversation.id)

    await publish_event(
        context.account_id,
        {"type": "conversation.updated", "conversation_id": str(conversation.id)},
    )
    return build_conversation_response(
        conversation=conversation,
        contact=contact,
        message=latest_message,
        unread=0,
        last_inbound_at=last_inbound,
    )


@router.post("/{conversation_id}/messages/text")
async def send_conversation_text(
    conversation_id: UUID,
    payload: ConversationSendTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation = await get_conversation_for_send(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = 403 if str(exc) == "CONVERSATION_FORBIDDEN" else 404
        raise HTTPException(status_code=code, detail="Conversation is not available") from exc

    from sqlalchemy import select
    from app.models.whatsapp_account import WhatsAppAccount
    from app.schemas.whatsapp import SendTextMessageRequest
    from app.services.whatsapp import send_text_message
    from app.services.meta_client import MetaAPIError

    result = await db.execute(
        select(WhatsAppAccount).where(
            WhatsAppAccount.channel_id == conversation.channel_id
        )
    )
    wa = result.scalar_one_or_none()
    if wa is None:
        raise HTTPException(status_code=400, detail="Conversation channel is not connected")

    from app.models.contact import Contact
    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    last_inbound = await get_last_inbound_for_conversation(db, conversation_id)
    window = compute_service_window(last_inbound)
    if window["requires_template"]:
        raise HTTPException(
            status_code=409,
            detail="SERVICE_WINDOW_CLOSED",
        )

    try:
        message = await send_text_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=wa.id,
            payload=SendTextMessageRequest(
                to=contact.external_address,
                text=payload.text,
            ),
        )
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await publish_event(
        context.account_id,
        {
            "type": "message.sent",
            "conversation_id": str(conversation_id),
            "message_id": str(message.id),
        },
    )
    return {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "status": message.status,
        "text_body": message.text_body,
        "created_at": message.created_at,
    }


@router.post("/{conversation_id}/messages/template")
async def send_conversation_template(
    conversation_id: UUID,
    payload: ConversationSendTemplateRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation = await get_conversation_for_send(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = 403 if str(exc) == "CONVERSATION_FORBIDDEN" else 404
        raise HTTPException(status_code=code, detail="Conversation is not available") from exc

    from sqlalchemy import select
    from app.models.contact import Contact
    from app.models.whatsapp_account import WhatsAppAccount
    from app.models.whatsapp_template import TemplateStatus, WhatsAppTemplate
    from app.schemas.whatsapp_media import SendTemplateMessageRequest
    from app.services.meta_client import MetaAPIError
    from app.services.template_media import resolve_send_components
    from app.services.whatsapp import send_template_message

    result = await db.execute(
        select(WhatsAppAccount).where(WhatsAppAccount.channel_id == conversation.channel_id)
    )
    wa = result.scalar_one_or_none()
    if wa is None:
        raise HTTPException(status_code=400, detail="Conversation channel is not connected")

    template = await db.get(WhatsAppTemplate, payload.template_id)
    if (
        template is None
        or template.account_id != context.account_id
        or template.whatsapp_account_id != wa.id
        or template.status != TemplateStatus.APPROVED
    ):
        raise HTTPException(status_code=400, detail="Template is not available")

    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    components = resolve_send_components(
        template.components,
        None,
        media_url=payload.media_url,
        filename=payload.filename,
    )
    try:
        message = await send_template_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=wa.id,
            payload=SendTemplateMessageRequest(
                to=contact.external_address,
                template_name=template.name,
                language_code=template.language,
                components=components,
            ),
        )
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await publish_event(
        context.account_id,
        {
            "type": "message.sent",
            "conversation_id": str(conversation_id),
            "message_id": str(message.id),
        },
    )
    return {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "status": message.status,
        "type": message.type,
        "created_at": message.created_at,
    }


@router.post("/{conversation_id}/messages/product")
async def send_conversation_product(
    conversation_id: UUID,
    payload: ConversationSendProductRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation = await get_conversation_for_send(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = 403 if str(exc) == "CONVERSATION_FORBIDDEN" else 404
        raise HTTPException(status_code=code, detail="Conversation is not available") from exc

    from app.models.catalog_product import CatalogProduct
    from app.models.contact import Contact
    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.catalog import format_price
    from app.services.catalog_commerce import resolve_retailer_id
    from app.services.meta_client import MetaAPIError
    from app.services.whatsapp import send_product_message

    product = await db.get(CatalogProduct, payload.product_id)
    if product is None or product.account_id != context.account_id or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")

    wa = (
        await db.execute(select(WhatsAppAccount).where(WhatsAppAccount.channel_id == conversation.channel_id))
    ).scalar_one_or_none()
    if wa is None:
        raise HTTPException(status_code=400, detail="Conversation channel is not connected")

    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    last_inbound = await get_last_inbound_for_conversation(db, conversation_id)
    window = compute_service_window(last_inbound)
    if window["requires_template"]:
        raise HTTPException(status_code=409, detail="SERVICE_WINDOW_CLOSED")

    body = payload.body or f"إليك *{product.name}* — {format_price(product)}"
    try:
        message = await send_product_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=wa.id,
            to=contact.external_address,
            catalog_id=wa.meta_catalog_id or "",
            product_retailer_id=resolve_retailer_id(product),
            body=body,
            footer=payload.footer,
            product_id=product.id,
        )
    except ValueError as exc:
        if str(exc) == "COMMERCE_NOT_CONFIGURED":
            raise HTTPException(status_code=409, detail="COMMERCE_NOT_CONFIGURED") from exc
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await publish_event(
        context.account_id,
        {"type": "message.sent", "conversation_id": str(conversation_id), "message_id": str(message.id)},
    )
    return {"id": str(message.id), "conversation_id": str(message.conversation_id), "status": message.status}


@router.post("/{conversation_id}/messages/product-list")
async def send_conversation_product_list(
    conversation_id: UUID,
    payload: ConversationSendProductListRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        conversation = await get_conversation_for_send(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            membership=context.membership,
        )
    except ValueError as exc:
        code = 403 if str(exc) == "CONVERSATION_FORBIDDEN" else 404
        raise HTTPException(status_code=code, detail="Conversation is not available") from exc

    from app.models.catalog_product import CatalogProduct
    from app.models.contact import Contact
    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.catalog_commerce import build_product_list_sections
    from app.services.meta_client import MetaAPIError
    from app.services.whatsapp import send_product_list_message

    products: list[CatalogProduct] = []
    for product_id in payload.product_ids:
        item = await db.get(CatalogProduct, product_id)
        if item is not None and item.account_id == context.account_id and item.is_active:
            products.append(item)
    if not products:
        raise HTTPException(status_code=400, detail="No catalog products selected")

    wa = (
        await db.execute(select(WhatsAppAccount).where(WhatsAppAccount.channel_id == conversation.channel_id))
    ).scalar_one_or_none()
    if wa is None:
        raise HTTPException(status_code=400, detail="Conversation channel is not connected")

    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    last_inbound = await get_last_inbound_for_conversation(db, conversation_id)
    window = compute_service_window(last_inbound)
    if window["requires_template"]:
        raise HTTPException(status_code=409, detail="SERVICE_WINDOW_CLOSED")

    try:
        message = await send_product_list_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=wa.id,
            to=contact.external_address,
            catalog_id=wa.meta_catalog_id or "",
            sections=build_product_list_sections(products),
            body=payload.body,
            header=payload.header,
            footer=payload.footer,
        )
    except ValueError as exc:
        if str(exc) == "COMMERCE_NOT_CONFIGURED":
            raise HTTPException(status_code=409, detail="COMMERCE_NOT_CONFIGURED") from exc
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await publish_event(
        context.account_id,
        {"type": "message.sent", "conversation_id": str(conversation_id), "message_id": str(message.id)},
    )
    return {"id": str(message.id), "conversation_id": str(message.conversation_id), "status": message.status}


@router.post("/{conversation_id}/csat")
async def post_conversation_csat(
    conversation_id: UUID,
    payload: ConversationRatingRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.csat import submit_conversation_rating

    try:
        rating = await submit_conversation_rating(
            db,
            account_id=context.account_id,
            conversation_id=conversation_id,
            score=payload.score,
            comment=payload.comment,
            source="agent",
        )
    except ValueError as exc:
        if str(exc) == "INVALID_SCORE":
            raise HTTPException(status_code=400, detail="Score must be 1-5") from exc
        raise HTTPException(status_code=404, detail="Conversation not found") from exc
    return {"id": str(rating.id), "score": rating.score, "comment": rating.comment}


@router.post("/{conversation_id}/read", status_code=204)
async def post_mark_read(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.inbox_extended import mark_conversation_read

    try:
        await mark_conversation_read(
            db, account_id=context.account_id, conversation_id=conversation_id, membership=context.membership
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{conversation_id}/unread", status_code=204)
async def post_mark_unread(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.inbox_extended import mark_conversation_unread

    try:
        await mark_conversation_unread(
            db, account_id=context.account_id, conversation_id=conversation_id, membership=context.membership
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


async def _load_conversation_contact(
    db: AsyncSession,
    *,
    account_id: UUID,
    conversation_id: UUID,
):
    from app.models.contact import Contact
    from app.models.conversation import Conversation

    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != account_id or conversation.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return conversation, contact


@router.get("/{conversation_id}/context", response_model=ConversationContextResponse)
async def get_conversation_context_route(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.inbox_context import get_conversation_context

    conversation, contact = await _load_conversation_contact(
        db, account_id=context.account_id, conversation_id=conversation_id
    )
    return await get_conversation_context(
        db,
        account_id=context.account_id,
        conversation=conversation,
        contact=contact,
        membership_id=context.membership.id,
    )


@router.post("/{conversation_id}/render-text")
async def post_render_conversation_text(
    conversation_id: UUID,
    payload: ConversationRenderTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.variables import build_contact_context, render_template

    _, contact = await _load_conversation_contact(
        db, account_id=context.account_id, conversation_id=conversation_id
    )
    rendered = render_template(payload.text, build_contact_context(contact))
    return {"text": rendered}


@router.post("/{conversation_id}/presence/view", status_code=204)
async def post_conversation_view_presence(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.inbox_presence import set_conversation_viewing

    await _load_conversation_contact(db, account_id=context.account_id, conversation_id=conversation_id)
    await set_conversation_viewing(
        account_id=context.account_id,
        conversation_id=conversation_id,
        membership_id=context.membership.id,
        user_name=context.user.full_name,
    )


@router.delete("/{conversation_id}/presence/view", status_code=204)
async def delete_conversation_view_presence(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
):
    from app.services.inbox_presence import clear_conversation_viewing

    await clear_conversation_viewing(
        account_id=context.account_id,
        conversation_id=conversation_id,
        membership_id=context.membership.id,
    )


@router.post("/{conversation_id}/presence/typing", status_code=204)
async def post_conversation_typing_presence(
    conversation_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CONVERSATIONS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.inbox_presence import set_conversation_typing

    await _load_conversation_contact(db, account_id=context.account_id, conversation_id=conversation_id)
    await set_conversation_typing(
        account_id=context.account_id,
        conversation_id=conversation_id,
        membership_id=context.membership.id,
        user_name=context.user.full_name,
    )
