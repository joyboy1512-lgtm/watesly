from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.config import settings
from app.core.meta_security import verify_meta_signature
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.whatsapp import (
    SendMessageResponse,
    SendTextMessageRequest,
    WhatsAppAccountCreateRequest,
    WhatsAppAccountResponse,
    WhatsAppCommerceSettingsRequest,
    WhatsAppEmbeddedSignupConfigResponse,
    WhatsAppEmbeddedSignupRequest,
    WhatsAppTokenStatusResponse,
    WhatsAppTokenUpdateRequest,
)
from app.schemas.whatsapp_media import (
    MediaSendResponse,
    SendMediaMessageRequest,
    SendProductListMessageRequest,
    SendProductMessageRequest,
    SendTemplateMessageRequest,
)
from app.services.meta_client import MetaAPIError
from app.realtime.manager import manager
from app.services.whatsapp import (
    _account_to_response,
    create_whatsapp_account,
    create_whatsapp_account_from_embedded,
    list_whatsapp_accounts,
    send_text_message,
    send_media_message,
    send_product_list_message,
    send_product_message,
    send_template_message,
    update_whatsapp_access_token,
)
from app.services.whatsapp_health import inspect_whatsapp_access_token, sync_whatsapp_account_health
from app.services.catalog_commerce import (
    commerce_readiness,
    update_whatsapp_commerce_settings,
)

router = APIRouter()


def _response(item) -> WhatsAppAccountResponse:
    return WhatsAppAccountResponse(**_account_to_response(item))


@router.get("/embedded-signup/config", response_model=WhatsAppEmbeddedSignupConfigResponse)
async def get_embedded_signup_config(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
):
    enabled = bool(settings.meta_app_id and settings.meta_embedded_signup_config_id)
    return WhatsAppEmbeddedSignupConfigResponse(
        enabled=enabled,
        app_id=settings.meta_app_id,
        config_id=settings.meta_embedded_signup_config_id,
        api_version=settings.meta_graph_api_version.strip("/"),
    )


@router.get("/webhook", include_in_schema=False)
async def verify_webhook(request: Request) -> Response:
    mode = request.query_params.get("hub.mode")
    verify_token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if (
        mode == "subscribe"
        and verify_token == settings.meta_webhook_verify_token.get_secret_value()
        and challenge is not None
    ):
        return Response(content=challenge, media_type="text/plain")

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook verification failed")


@router.post("/webhook", include_in_schema=False)
async def receive_webhook(
    request: Request,
) -> dict[str, str]:
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not verify_meta_signature(raw_body, signature):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        import json

        payload = json.loads(raw_body.decode("utf-8"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    from app.workers.webhook_tasks import process_whatsapp_webhook

    process_whatsapp_webhook.delay(payload)
    return {"status": "accepted"}


@router.get("/accounts", response_model=list[WhatsAppAccountResponse])
async def get_whatsapp_accounts(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    accounts = await list_whatsapp_accounts(db, context.account_id)
    return [
        WhatsAppAccountResponse(**_account_to_response(item, channel_name=channel_name, organization_name=organization_name))
        for item, channel_name, organization_name in accounts
    ]


@router.post(
    "/accounts",
    response_model=WhatsAppAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_whatsapp_account(
    payload: WhatsAppAccountCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await create_whatsapp_account(
            db, account_id=context.account_id, payload=payload
        )
    except ValueError as exc:
        messages = {
            "INVALID_CHANNEL": (400, "Channel is invalid"),
            "CHANNEL_NOT_WHATSAPP": (400, "Selected channel is not a WhatsApp channel"),
            "PHONE_NUMBER_ALREADY_CONNECTED": (409, "Phone number is already connected"),
            "INVALID_ACCESS_TOKEN": (400, "Meta access token is invalid or expired"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to connect WhatsApp account"))
        raise HTTPException(status_code=code, detail=detail) from exc

    return _response(item)


@router.post(
    "/accounts/embedded",
    response_model=WhatsAppAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_whatsapp_account_embedded(
    payload: WhatsAppEmbeddedSignupRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await create_whatsapp_account_from_embedded(
            db, account_id=context.account_id, payload=payload
        )
    except ValueError as exc:
        messages = {
            "INVALID_CHANNEL": (400, "Channel is invalid"),
            "CHANNEL_NOT_WHATSAPP": (400, "Selected channel is not a WhatsApp channel"),
            "PHONE_NUMBER_ALREADY_CONNECTED": (409, "Phone number is already connected"),
            "MISSING_ACCESS_TOKEN": (400, "Authorization code or access token is required"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to connect WhatsApp account"))
        raise HTTPException(status_code=code, detail=detail) from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return _response(item)


@router.patch("/accounts/{whatsapp_account_id}/access-token", response_model=WhatsAppAccountResponse)
async def patch_whatsapp_access_token(
    whatsapp_account_id: UUID,
    payload: WhatsAppTokenUpdateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await update_whatsapp_access_token(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            access_token=payload.access_token,
        )
    except ValueError as exc:
        messages = {
            "WHATSAPP_ACCOUNT_NOT_FOUND": (404, "WhatsApp account not found"),
            "INVALID_ACCESS_TOKEN": (400, "Meta access token is invalid or expired"),
        }
        code, detail = messages.get(str(exc), (400, "Unable to update access token"))
        raise HTTPException(status_code=code, detail=detail) from exc
    return _response(item)


@router.get("/accounts/{whatsapp_account_id}/token-status", response_model=WhatsAppTokenStatusResponse)
async def get_whatsapp_token_status(
    whatsapp_account_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.core.encryption import decrypt_secret
    from app.models.whatsapp_account import WhatsAppAccount

    item = await db.get(WhatsAppAccount, whatsapp_account_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="WhatsApp account not found")
    result = await inspect_whatsapp_access_token(
        access_token=decrypt_secret(item.access_token_encrypted),
        phone_number_id=item.phone_number_id,
    )
    return WhatsAppTokenStatusResponse(**result)


@router.post("/accounts/{whatsapp_account_id}/sync-health", response_model=WhatsAppAccountResponse)
async def post_sync_account_health(
    whatsapp_account_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.whatsapp_account import WhatsAppAccount

    item = await db.get(WhatsAppAccount, whatsapp_account_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="WhatsApp account not found")
    try:
        item = await sync_whatsapp_account_health(db, whatsapp_account=item)
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _response(item)


@router.post("/accounts/{whatsapp_account_id}/disconnect", response_model=WhatsAppAccountResponse)
async def post_disconnect_whatsapp_account(
    whatsapp_account_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.whatsapp_account import WhatsAppAccount, WhatsAppAccountStatus

    item = await db.get(WhatsAppAccount, whatsapp_account_id)
    if item is None or item.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="WhatsApp account not found")
    item.status = WhatsAppAccountStatus.DISCONNECTED
    await db.commit()
    await db.refresh(item)
    return _response(item)


@router.post(
    "/accounts/{whatsapp_account_id}/messages/text",
    response_model=SendMessageResponse,
)
async def post_text_message(
    whatsapp_account_id: UUID,
    payload: SendTextMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
) -> SendMessageResponse:
    try:
        message = await send_text_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            payload=payload,
            record_mac=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "message": str(exc),
                "provider_status": exc.status_code,
                "provider_response": exc.response_data,
            },
        ) from exc

    return SendMessageResponse(
        local_message_id=message.id,
        external_message_id=message.external_message_id,
        status=message.status,
    )


async def _send_media(
    media_type,
    whatsapp_account_id,
    payload,
    context,
    db,
):
    try:
        message = await send_media_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            media_type=media_type,
            payload=payload,
            record_mac=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return MediaSendResponse(
        local_message_id=message.id,
        external_message_id=message.external_message_id,
        status=message.status,
    )


@router.post("/accounts/{whatsapp_account_id}/messages/image", response_model=MediaSendResponse)
async def post_image_message(
    whatsapp_account_id: UUID,
    payload: SendMediaMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.message import MessageType
    return await _send_media(MessageType.IMAGE, whatsapp_account_id, payload, context, db)


@router.post("/accounts/{whatsapp_account_id}/messages/video", response_model=MediaSendResponse)
async def post_video_message(
    whatsapp_account_id: UUID,
    payload: SendMediaMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.message import MessageType
    return await _send_media(MessageType.VIDEO, whatsapp_account_id, payload, context, db)


@router.post("/accounts/{whatsapp_account_id}/messages/document", response_model=MediaSendResponse)
async def post_document_message(
    whatsapp_account_id: UUID,
    payload: SendMediaMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.message import MessageType
    return await _send_media(MessageType.DOCUMENT, whatsapp_account_id, payload, context, db)


@router.post("/accounts/{whatsapp_account_id}/messages/audio", response_model=MediaSendResponse)
async def post_audio_message(
    whatsapp_account_id: UUID,
    payload: SendMediaMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.message import MessageType
    return await _send_media(MessageType.AUDIO, whatsapp_account_id, payload, context, db)


@router.post("/accounts/{whatsapp_account_id}/messages/template", response_model=MediaSendResponse)
async def post_template_message(
    whatsapp_account_id: UUID,
    payload: SendTemplateMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        message = await send_template_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            payload=payload,
            record_mac=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return MediaSendResponse(
        local_message_id=message.id,
        external_message_id=message.external_message_id,
        status=message.status,
    )


@router.patch("/accounts/{whatsapp_account_id}/commerce", response_model=WhatsAppAccountResponse)
async def patch_whatsapp_commerce(
    whatsapp_account_id: UUID,
    payload: WhatsAppCommerceSettingsRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await update_whatsapp_commerce_settings(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            meta_catalog_id=payload.meta_catalog_id,
            commerce_enabled=payload.commerce_enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    return _response(item)


@router.get("/accounts/{whatsapp_account_id}/commerce/readiness")
async def get_whatsapp_commerce_readiness(
    whatsapp_account_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await commerce_readiness(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc


@router.post("/accounts/{whatsapp_account_id}/messages/product", response_model=MediaSendResponse)
async def post_product_message(
    whatsapp_account_id: UUID,
    payload: SendProductMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.whatsapp_account import WhatsAppAccount

    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available")
    try:
        message = await send_product_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            to=payload.to,
            catalog_id=wa.meta_catalog_id or "",
            product_retailer_id=payload.product_retailer_id,
            body=payload.body,
            footer=payload.footer,
            product_id=payload.product_id,
        )
    except ValueError as exc:
        if str(exc) == "COMMERCE_NOT_CONFIGURED":
            raise HTTPException(status_code=409, detail="COMMERCE_NOT_CONFIGURED") from exc
        raise HTTPException(status_code=404, detail="WhatsApp account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return MediaSendResponse(
        local_message_id=message.id,
        external_message_id=message.external_message_id,
        status=message.status,
    )


@router.post("/accounts/{whatsapp_account_id}/messages/product-list", response_model=MediaSendResponse)
async def post_product_list_message(
    whatsapp_account_id: UUID,
    payload: SendProductListMessageRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    from app.models.catalog_product import CatalogProduct
    from app.models.whatsapp_account import WhatsAppAccount
    from app.services.catalog_commerce import build_product_list_sections

    wa = await db.get(WhatsAppAccount, whatsapp_account_id)
    if wa is None or wa.account_id != context.account_id:
        raise HTTPException(status_code=404, detail="WhatsApp account is not available")

    products: list[CatalogProduct] = []
    if payload.product_ids:
        for product_id in payload.product_ids:
            item = await db.get(CatalogProduct, product_id)
            if item is not None and item.account_id == context.account_id and item.is_active:
                products.append(item)
    sections = build_product_list_sections(products) if products else []
    if not sections:
        raise HTTPException(status_code=400, detail="No catalog products selected")

    try:
        message = await send_product_list_message(
            db,
            account_id=context.account_id,
            whatsapp_account_id=whatsapp_account_id,
            to=payload.to,
            catalog_id=wa.meta_catalog_id or "",
            sections=sections,
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
    return MediaSendResponse(
        local_message_id=message.id,
        external_message_id=message.external_message_id,
        status=message.status,
    )
