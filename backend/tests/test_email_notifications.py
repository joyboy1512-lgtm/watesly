from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.services import account_email_settings as settings_service
from app.services import email_notifications


def test_normalize_email_list() -> None:
    result = settings_service.normalize_email_list(
        [" Info@Watesly.com ", "info@watesly.com", "bad@", "sales@watesly.com"]
    )
    assert result == ["info@watesly.com", "sales@watesly.com"]


def test_parse_env_email_list() -> None:
    assert settings_service.parse_env_email_list("a@x.com,b@y.com") == ["a@x.com", "b@y.com"]


@pytest.mark.asyncio
async def test_send_catalog_order_notification_skips_without_recipients(monkeypatch) -> None:
    monkeypatch.setattr(
        email_notifications,
        "resolve_catalog_order_recipients",
        AsyncMock(return_value=[]),
    )
    sent = await email_notifications.send_catalog_order_notification(
        AsyncMock(),
        account_id=uuid4(),
        order=AsyncMock(),
    )
    assert sent is False


@pytest.mark.asyncio
async def test_send_catalog_order_notification_with_pdf(monkeypatch) -> None:
    order = AsyncMock()
    order.id = uuid4()
    order.order_number = "ORD-20260821-0001"
    order.subtotal = Decimal("12.50")
    order.currency = "KWD"
    order.customer_note = "صباحاً"
    order.line_items = [
        {
            "product_name": "صابون",
            "product_retailer_id": "sku-1",
            "quantity": 2,
            "line_total": "12.50",
            "currency": "KWD",
        }
    ]
    order.conversation_id = uuid4()

    monkeypatch.setattr(
        email_notifications,
        "resolve_catalog_order_recipients",
        AsyncMock(return_value=["orders@watesly.com"]),
    )
    monkeypatch.setattr(
        email_notifications,
        "get_invoice_context",
        AsyncMock(
            return_value={
                "company_name": "Olive",
                "customer_name": "أحمد",
                "customer_phone": "+96560000000",
            }
        ),
    )
    monkeypatch.setattr(
        email_notifications,
        "generate_catalog_order_invoice_pdf",
        lambda _ctx: b"%PDF-test",
    )
    send_email = AsyncMock()
    monkeypatch.setattr(email_notifications, "send_email", send_email)
    monkeypatch.setattr(email_notifications, "is_email_configured", lambda: True)

    sent = await email_notifications.send_catalog_order_notification(
        AsyncMock(),
        account_id=uuid4(),
        order=order,
    )
    assert sent is True
    send_email.assert_awaited_once()
    assert send_email.await_args.kwargs["attachments"][0][0].endswith(".pdf")


@pytest.mark.asyncio
async def test_dispatch_notification_email_skips_catalog_order_type(monkeypatch) -> None:
    notification = AsyncMock()
    notification.type = "catalog_order_received"
    sent = await email_notifications.dispatch_notification_email(AsyncMock(), notification=notification)
    assert sent is False
