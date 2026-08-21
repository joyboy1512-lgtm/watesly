"""Send operational emails for notifications and catalog orders."""

from __future__ import annotations

import logging
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.catalog_order import CatalogOrder
from app.models.notification import Notification
from app.services.account_email_settings import (
    resolve_catalog_order_recipients,
    resolve_notification_recipients,
)
from app.services.catalog_order_pdf import generate_catalog_order_invoice_pdf
from app.services.catalog_orders import get_invoice_context
from app.services.email import is_email_configured, send_email

logger = logging.getLogger(__name__)


def _format_money(value: Decimal | str | None, currency: str) -> str:
    if value is None:
        return "—"
    amount = Decimal(str(value))
    return f"{amount:.2f} {currency}"


def _format_line_items_text(line_items: list[dict]) -> str:
    lines: list[str] = []
    for item in line_items:
        name = str(item.get("product_name") or item.get("product_retailer_id") or "منتج")
        qty = int(item.get("quantity") or 1)
        total = item.get("line_total")
        currency = str(item.get("currency") or "KWD")
        lines.append(f"- {name} × {qty} — {total or '—'} {currency}".strip())
    return "\n".join(lines) if lines else "-"


def _format_line_items_html(line_items: list[dict]) -> str:
    rows = []
    for item in line_items:
        name = str(item.get("product_name") or item.get("product_retailer_id") or "منتج")
        qty = int(item.get("quantity") or 1)
        total = item.get("line_total") or "—"
        currency = str(item.get("currency") or "KWD")
        rows.append(
            f"<tr><td>{name}</td><td>{qty}</td><td>{total} {currency}</td></tr>"
        )
    if not rows:
        return "<p>لا توجد بنود.</p>"
    return (
        "<table style='width:100%;border-collapse:collapse;font-size:14px;'>"
        "<thead><tr>"
        "<th style='text-align:right;padding:8px;border-bottom:1px solid #e6ece9;'>المنتج</th>"
        "<th style='text-align:right;padding:8px;border-bottom:1px solid #e6ece9;'>الكمية</th>"
        "<th style='text-align:right;padding:8px;border-bottom:1px solid #e6ece9;'>الإجمالي</th>"
        "</tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )


def _email_shell(*, title: str, body_html: str, footer: str | None = None) -> str:
    footer_html = f"<p style='margin:16px 0 0;font-size:12px;color:#667781;'>{footer}</p>" if footer else ""
    return f"""\
<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <body style="font-family:Arial,sans-serif;line-height:1.7;color:#111b21;background:#f6faf8;padding:24px;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e6ece9;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#075e54;">{title}</h1>
      {body_html}
      {footer_html}
    </div>
  </body>
</html>
"""


async def _send_to_recipients(
    *,
    recipients: list[str],
    subject: str,
    text_body: str,
    html_body: str,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> int:
    if not is_email_configured() or not recipients:
        return 0
    sent = 0
    for recipient in recipients:
        try:
            await send_email(
                to=recipient,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
                attachments=attachments,
            )
            sent += 1
        except Exception:
            logger.exception("Failed to send email to %s", recipient)
    return sent


async def send_catalog_order_notification(
    db: AsyncSession,
    *,
    account_id: UUID,
    order: CatalogOrder,
) -> bool:
    recipients = await resolve_catalog_order_recipients(db, account_id=account_id)
    if not recipients:
        return False

    invoice_context = await get_invoice_context(db, account_id=account_id, order=order)
    line_items = order.line_items or []
    order_url = f"{settings.app_public_url.rstrip('/')}/catalog/orders/{order.id}"
    subject = f"طلب كتالوج جديد — {order.order_number}"
    text_body = (
        f"تم استلام طلب جديد من WhatsApp Catalog.\n\n"
        f"رقم الطلب: {order.order_number}\n"
        f"العميل: {invoice_context.get('customer_name')} ({invoice_context.get('customer_phone')})\n"
        f"الإجمالي: {_format_money(order.subtotal, order.currency)}\n"
        f"ملاحظة العميل: {order.customer_note or '—'}\n\n"
        f"البنود:\n{_format_line_items_text(line_items)}\n\n"
        f"عرض الطلب: {order_url}\n"
        f"مرفق: فاتورة PDF\n"
    )
    html_body = _email_shell(
        title="طلب كتالوج جديد",
        body_html=(
            f"<p>تم استلام طلب جديد من <strong>WhatsApp Catalog</strong>.</p>"
            f"<p><strong>رقم الطلب:</strong> {order.order_number}<br>"
            f"<strong>العميل:</strong> {invoice_context.get('customer_name')} "
            f"<span dir='ltr'>({invoice_context.get('customer_phone')})</span><br>"
            f"<strong>الإجمالي:</strong> {_format_money(order.subtotal, order.currency)}</p>"
            f"<p><strong>ملاحظة العميل:</strong> {order.customer_note or '—'}</p>"
            f"{_format_line_items_html(line_items)}"
            f"<p style='margin-top:18px;'>"
            f"<a href='{order_url}' style='display:inline-block;background:#25d366;color:#fff;"
            f"text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px;'>"
            f"فتح الطلب في Watesly</a></p>"
            f"<p style='font-size:13px;color:#667781;'>مرفق مع هذه الرسالة ملف PDF للفاتورة.</p>"
        ),
    )

    try:
        pdf_bytes = generate_catalog_order_invoice_pdf(invoice_context)
    except Exception:
        logger.exception("Failed to generate catalog order invoice PDF for order %s", order.id)
        pdf_bytes = None

    attachments = None
    if pdf_bytes:
        attachments = [(f"{order.order_number}.pdf", pdf_bytes, "application/pdf")]

    sent_count = await _send_to_recipients(
        recipients=recipients,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        attachments=attachments,
    )
    return sent_count > 0


async def dispatch_notification_email(
    db: AsyncSession,
    *,
    notification: Notification,
) -> bool:
    if notification.type == "catalog_order_received":
        return False

    recipients = await resolve_notification_recipients(
        db,
        account_id=notification.account_id,
        user_id=notification.user_id,
    )
    if not recipients:
        return False

    app_link = settings.app_public_url.rstrip("/")
    conversation_id = (notification.data or {}).get("conversation_id")
    action_link = f"{app_link}/inbox"
    if conversation_id:
        action_link = f"{app_link}/inbox?conversation={conversation_id}"

    subject = f"Watesly — {notification.title}"
    text_body = (
        f"{notification.title}\n\n"
        f"{notification.body}\n\n"
        f"نوع الإشعار: {notification.type}\n"
        f"افتح Watesly: {action_link}\n"
    )
    html_body = _email_shell(
        title=notification.title,
        body_html=(
            f"<p>{notification.body}</p>"
            f"<p style='font-size:13px;color:#667781;'>نوع الإشعار: {notification.type}</p>"
            f"<p><a href='{action_link}' style='display:inline-block;background:#128c7e;color:#fff;"
            f"text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px;'>"
            f"فتح Watesly</a></p>"
        ),
        footer="يمكنك إيقاف رسائل البريد من إعدادات المطور → البريد.",
    )
    sent_count = await _send_to_recipients(
        recipients=recipients,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )
    return sent_count > 0
