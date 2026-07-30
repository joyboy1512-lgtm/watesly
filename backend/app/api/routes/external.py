from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.api_key import ApiKeyContext, require_api_scope
from app.db.session import get_db
from app.models.channel import Channel
from app.models.organization import Organization
from app.schemas.contact import ContactCreateRequest, ContactResponse
from app.services.campaigns import list_campaigns
from app.services.contacts import create_contact, list_contacts
from app.services.crm import create_deal, get_deal, list_deals
from app.services.contact_management import get_contact_or_raise

router = APIRouter()


class ExternalMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


class ExternalContactCreate(BaseModel):
    phone: str = Field(min_length=3, max_length=120)
    display_name: str | None = None
    email: str | None = None
    organization_id: UUID | None = None
    channel_id: UUID | None = None


class ExternalDealCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    contact_id: UUID | None = None
    amount: str | None = None
    stage: str = "lead"


async def _default_org_channel(db: AsyncSession, account_id: UUID) -> tuple[UUID, UUID]:
    org = await db.scalar(select(Organization.id).where(Organization.account_id == account_id).limit(1))
    channel = await db.scalar(select(Channel.id).where(Channel.account_id == account_id).limit(1))
    if org is None or channel is None:
        raise HTTPException(status_code=400, detail="Account missing organization or channel")
    return org, channel


@router.get("/me")
async def external_me(context: ApiKeyContext = Depends(require_api_scope("contacts:read"))):
    return {
        "account_id": str(context.account_id),
        "key_id": str(context.api_key.id),
        "key_name": context.api_key.name,
        "scopes": list(context.scopes),
        "request_count": int(context.api_key.request_count or 0),
    }


@router.get("/contacts", response_model=list[ContactResponse])
async def external_list_contacts(
    limit: int = Query(100, ge=1, le=200),
    q: str | None = None,
    context: ApiKeyContext = Depends(require_api_scope("contacts:read")),
    db: AsyncSession = Depends(get_db),
):
    return await list_contacts(db, context.account_id, limit=limit, q=q)


@router.post("/contacts", response_model=ContactResponse, status_code=201)
async def external_create_contact(
    payload: ExternalContactCreate,
    context: ApiKeyContext = Depends(require_api_scope("contacts:write")),
    db: AsyncSession = Depends(get_db),
):
    org_id = payload.organization_id
    channel_id = payload.channel_id
    if org_id is None or channel_id is None:
        default_org, default_channel = await _default_org_channel(db, context.account_id)
        org_id = org_id or default_org
        channel_id = channel_id or default_channel
    body = ContactCreateRequest(
        organization_id=org_id,
        channel_id=channel_id,
        external_address=payload.phone,
        display_name=payload.display_name,
        email=payload.email,
    )
    contact = await create_contact(db, account_id=context.account_id, payload=body)
    from app.services.webhook_dispatch import dispatch_account_webhook

    await dispatch_account_webhook(
        db,
        account_id=context.account_id,
        event_type="contact.created",
        payload={"contact_id": str(contact.id), "phone": contact.external_address},
    )
    return contact


@router.get("/contacts/{contact_id}", response_model=ContactResponse)
async def external_get_contact(
    contact_id: UUID,
    context: ApiKeyContext = Depends(require_api_scope("contacts:read")),
    db: AsyncSession = Depends(get_db),
):
    return await get_contact_or_raise(db, account_id=context.account_id, contact_id=contact_id)


@router.post("/conversations/{conversation_id}/messages", status_code=201)
async def external_send_message(
    conversation_id: UUID,
    payload: ExternalMessageRequest,
    context: ApiKeyContext = Depends(require_api_scope("messages:send")),
    db: AsyncSession = Depends(get_db),
):
    from app.models.contact import Contact
    from app.models.conversation import Conversation
    from app.models.whatsapp_account import WhatsAppAccount
    from app.schemas.whatsapp import SendTextMessageRequest
    from app.services.conversations import get_last_inbound_for_conversation
    from app.services.service_window import compute_service_window
    from app.services.whatsapp import send_text_message
    from app.services.webhook_dispatch import dispatch_account_webhook
    from sqlalchemy import select

    conversation = await db.get(Conversation, conversation_id)
    if conversation is None or conversation.account_id != context.account_id or conversation.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    wa = await db.scalar(
        select(WhatsAppAccount).where(WhatsAppAccount.channel_id == conversation.channel_id)
    )
    if wa is None:
        raise HTTPException(status_code=400, detail="Channel not connected to WhatsApp")

    contact = await db.get(Contact, conversation.contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    last_inbound = await get_last_inbound_for_conversation(db, conversation_id)
    window = compute_service_window(last_inbound)
    if window["requires_template"]:
        raise HTTPException(status_code=409, detail="SERVICE_WINDOW_CLOSED")

    try:
        message = await send_text_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=wa.id,
            payload=SendTextMessageRequest(to=contact.external_address, text=payload.text),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    await dispatch_account_webhook(
        db,
        account_id=context.account_id,
        event_type="message.sent",
        payload={"conversation_id": str(conversation_id), "message_id": str(message.id)},
    )
    return {"id": str(message.id), "conversation_id": str(conversation_id), "status": "sent"}


@router.get("/campaigns")
async def external_list_campaigns(
    limit: int = Query(50, ge=1, le=100),
    context: ApiKeyContext = Depends(require_api_scope("campaigns:read")),
    db: AsyncSession = Depends(get_db),
):
    items = await list_campaigns(db, context.account_id, limit=limit)
    return [{"id": str(c.id), "name": c.name, "status": c.status.value if hasattr(c.status, "value") else str(c.status)} for c in items]


@router.get("/crm/deals")
async def external_list_deals(
    limit: int = Query(100, ge=1, le=200),
    stage: str | None = None,
    context: ApiKeyContext = Depends(require_api_scope("crm:read")),
    db: AsyncSession = Depends(get_db),
):
    return await list_deals(db, context.account_id, limit=limit, stage=stage)


@router.post("/crm/deals", status_code=201)
async def external_create_deal(
    payload: ExternalDealCreate,
    context: ApiKeyContext = Depends(require_api_scope("crm:write")),
    db: AsyncSession = Depends(get_db),
):
    from decimal import Decimal
    from app.services.webhook_dispatch import dispatch_account_webhook

    amount = Decimal(payload.amount or "0")
    deal = await create_deal(
        db,
        account_id=context.account_id,
        title=payload.title,
        contact_id=payload.contact_id,
        amount=amount,
        stage=payload.stage,
        source="api",
    )
    result = await get_deal(db, account_id=context.account_id, deal_id=deal.id)
    await dispatch_account_webhook(
        db,
        account_id=context.account_id,
        event_type="deal.created",
        payload={"deal_id": str(deal.id), "title": deal.title},
    )
    return result


@router.get("/crm/deals/{deal_id}")
async def external_get_deal(
    deal_id: UUID,
    context: ApiKeyContext = Depends(require_api_scope("crm:read")),
    db: AsyncSession = Depends(get_db),
):
    return await get_deal(db, account_id=context.account_id, deal_id=deal_id)
