"""Meta onboarding helpers — discover numbers, subscribe webhooks."""

from __future__ import annotations

from app.core.config import settings
from app.models.whatsapp_account import WhatsAppAccount
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient


def whatsapp_webhook_callback_url() -> str:
    base = settings.public_api_base_url.rstrip("/")
    return f"{base}/api/v1/whatsapp/webhook"


def extract_waba_ids_from_debug(debug_payload: dict) -> list[str]:
    data = debug_payload.get("data", debug_payload)
    if not isinstance(data, dict):
        return []

    waba_ids: list[str] = []
    for scope in data.get("granular_scopes", []) or []:
        if not isinstance(scope, dict):
            continue
        scope_name = str(scope.get("scope", "")).lower()
        if "whatsapp" not in scope_name:
            continue
        for target_id in scope.get("target_ids", []) or []:
            value = str(target_id).strip()
            if value and value not in waba_ids:
                waba_ids.append(value)
    return waba_ids


async def discover_whatsapp_accounts(access_token: str) -> list[dict]:
    client = MetaWhatsAppClient(access_token=access_token, phone_number_id="0")
    try:
        debug = await client.debug_access_token()
        waba_ids = extract_waba_ids_from_debug(debug)
        if not waba_ids:
            raise MetaAPIError(
                "Token has no WhatsApp Business access. Use a System User token with whatsapp_business_management.",
                status_code=400,
            )

        discovered: list[dict] = []
        for waba_id in waba_ids:
            phones = await client.list_waba_phone_numbers(waba_id=waba_id)
            discovered.append(
                {
                    "waba_id": waba_id,
                    "phone_numbers": [
                        {
                            "phone_number_id": str(item.get("id")),
                            "display_phone_number": item.get("display_phone_number"),
                            "verified_name": item.get("verified_name"),
                            "quality_rating": item.get("quality_rating"),
                            "status": item.get("status"),
                        }
                        for item in phones
                        if item.get("id")
                    ],
                }
            )
        return discovered
    finally:
        await client.aclose()


async def ensure_waba_webhook_subscription(
    *,
    access_token: str,
    waba_id: str,
) -> dict:
    client = MetaWhatsAppClient(access_token=access_token, phone_number_id="0")
    callback_url = whatsapp_webhook_callback_url()
    verify_token = settings.meta_webhook_verify_token.get_secret_value()
    try:
        return await client.subscribe_waba_webhooks(
            waba_id=waba_id,
            callback_url=callback_url,
            verify_token=verify_token,
        )
    finally:
        await client.aclose()


async def get_waba_webhook_status(*, whatsapp_account: WhatsAppAccount) -> dict:
    from app.core.encryption import decrypt_secret

    client = MetaWhatsAppClient(
        access_token=decrypt_secret(whatsapp_account.access_token_encrypted),
        phone_number_id=whatsapp_account.phone_number_id,
    )
    try:
        rows = await client.get_waba_webhook_subscriptions(waba_id=whatsapp_account.waba_id)
        callback_url = whatsapp_webhook_callback_url()
        subscribed = any(
            isinstance(row, dict)
            and (
                row.get("whatsapp_business_api_data", {}).get("link") == callback_url
                or callback_url in str(row)
            )
            for row in rows
        )
        if not subscribed and rows:
            subscribed = True
        return {"subscribed": subscribed, "callback_url": callback_url, "subscriptions": rows}
    except MetaAPIError as exc:
        return {"subscribed": False, "callback_url": whatsapp_webhook_callback_url(), "error": str(exc)}
    finally:
        await client.aclose()
