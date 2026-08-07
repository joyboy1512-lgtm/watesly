"""Public ecommerce webhooks (Shopify/WooCommerce) — secret-gated."""

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_secret
from app.db.session import get_db
from app.models.ecommerce_connection import EcommerceConnection
from app.services.ecommerce_integrations import handle_ecommerce_webhook

router = APIRouter()


class EcommerceWebhookPayload(BaseModel):
    event_type: str = Field(min_length=3, max_length=40)
    phone: str | None = None
    customer_phone: str | None = None
    order_id: str | None = None
    order_number: str | None = None
    total: str | None = None
    status: str | None = None
    extra: dict = Field(default_factory=dict)


@router.post("/{provider}/{connection_id}")
async def ecommerce_inbound_webhook(
    provider: str,
    connection_id: UUID,
    payload: EcommerceWebhookPayload,
    x_watesly_secret: str | None = Header(default=None, alias="X-Watesly-Secret"),
    db: AsyncSession = Depends(get_db),
):
    connection = await db.get(EcommerceConnection, connection_id)
    if connection is None or not connection.is_active or connection.provider != provider.lower():
        raise HTTPException(status_code=404, detail="Connection not found")

    if connection.webhook_secret_encrypted:
        expected = decrypt_secret(connection.webhook_secret_encrypted)
        if not x_watesly_secret or x_watesly_secret != expected:
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    body = payload.model_dump()
    body.update(body.pop("extra", {}))
    result = await handle_ecommerce_webhook(
        db,
        account_id=connection.account_id,
        provider=provider.lower(),
        event_type=payload.event_type,
        payload=body,
        send_message=True,
    )
    if result.get("status") == "failed":
        raise HTTPException(status_code=422, detail=result.get("reason", "send_failed"))
    return result
