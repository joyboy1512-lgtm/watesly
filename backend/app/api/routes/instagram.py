from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import AuthContext, require_permissions
from app.core.config import settings
from app.core.meta_security import verify_meta_signature
from app.core.permissions import Permission
from app.db.session import get_db
from app.schemas.instagram import (
    InstagramAccountCreateRequest,
    InstagramAccountResponse,
    InstagramSendMessageResponse,
    InstagramSendTextRequest,
    InstagramWebhookStatusResponse,
)
from app.services.instagram import (
    _account_to_dict,
    create_instagram_account,
    disconnect_instagram_account,
    instagram_webhook_callback_url,
    list_instagram_accounts,
    process_instagram_webhook,
    send_instagram_text_message,
)
from app.services.meta_client import MetaAPIError

router = APIRouter()


def _response(item, *, channel_name=None, organization_name=None) -> InstagramAccountResponse:
    return InstagramAccountResponse(
        **_account_to_dict(item, channel_name=channel_name, organization_name=organization_name)
    )


@router.get("/webhook", include_in_schema=False)
async def verify_instagram_webhook(request: Request) -> Response:
    mode = request.query_params.get("hub.mode")
    verify_token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if (
        mode == "subscribe"
        and challenge
        and verify_token == settings.meta_webhook_verify_token.get_secret_value()
    ):
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook verification failed")


@router.post("/webhook", include_in_schema=False)
async def receive_instagram_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str | int]:
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not verify_meta_signature(raw_body, signature):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        import json

        payload = json.loads(raw_body.decode("utf-8"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    # Accept both dedicated Instagram callbacks and shared Meta app callbacks.
    result = await process_instagram_webhook(db, payload)
    return {"status": "accepted", **result}


@router.get("/accounts", response_model=list[InstagramAccountResponse])
async def get_instagram_accounts(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    from app.services.membership_access import resolve_accessible_channel_ids

    accounts = await list_instagram_accounts(db, context.account_id)
    accessible = await resolve_accessible_channel_ids(
        db, account_id=context.account_id, membership=context.membership
    )
    if accessible is not None:
        allowed = set(accessible)
        accounts = [row for row in accounts if row[0].channel_id in allowed]
    return [
        _response(item, channel_name=channel_name, organization_name=organization_name)
        for item, channel_name, organization_name in accounts
    ]


@router.post("/accounts", response_model=InstagramAccountResponse, status_code=status.HTTP_201_CREATED)
async def post_instagram_account(
    payload: InstagramAccountCreateRequest,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await create_instagram_account(db, account_id=context.account_id, payload=payload)
    except ValueError as exc:
        messages = {
            "INVALID_CHANNEL": (400, "Channel is invalid"),
            "CHANNEL_NOT_INSTAGRAM": (400, "Selected channel is not an Instagram channel"),
            "INVALID_ACCESS_TOKEN": (400, "رمز Page Access Token غير صالح أو منتهي"),
            "INSTAGRAM_NOT_LINKED_TO_PAGE": (
                400,
                "لا يوجد حساب Instagram Business مربوط بهذه الصفحة. اربط الحساب من Meta Business Suite.",
            ),
            "IG_ACCOUNT_ALREADY_CONNECTED": (409, "حساب Instagram مربوط مسبقاً"),
        }
        code, detail = messages.get(str(exc), (400, "تعذر ربط Instagram"))
        raise HTTPException(status_code=code, detail=detail) from exc
    return _response(item)


@router.post("/accounts/{instagram_account_id}/disconnect", response_model=InstagramAccountResponse)
async def post_disconnect_instagram_account(
    instagram_account_id: UUID,
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_MANAGE, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await disconnect_instagram_account(
            db, account_id=context.account_id, instagram_account_id=instagram_account_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Instagram account not found") from exc
    return _response(item)


@router.get("/webhook-callback", response_model=InstagramWebhookStatusResponse)
async def get_instagram_webhook_callback(
    context: AuthContext = Depends(require_permissions(Permission.CHANNELS_VIEW)),
):
    return InstagramWebhookStatusResponse(
        subscribed=True,
        callback_url=instagram_webhook_callback_url(),
        error=None,
    )


@router.post(
    "/accounts/{instagram_account_id}/messages/text",
    response_model=InstagramSendMessageResponse,
)
async def post_instagram_text_message(
    instagram_account_id: UUID,
    payload: InstagramSendTextRequest,
    context: AuthContext = Depends(require_permissions(Permission.MESSAGES_SEND, write=True)),
    db: AsyncSession = Depends(get_db),
):
    try:
        message = await send_instagram_text_message(
            db,
            account_id=context.account_id,
            instagram_account_id=instagram_account_id,
            to=payload.to,
            text=payload.text,
            record_mac=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Instagram account is not available") from exc
    except MetaAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return InstagramSendMessageResponse(
        status="sent",
        message_id=str(message.id),
        provider_response=message.provider_payload if isinstance(message.provider_payload, dict) else None,
    )
