from __future__ import annotations

import asyncio
import base64
import logging
import smtplib
from email.message import EmailMessage
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.models.membership import MembershipRole

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"

EmailAttachment = tuple[str, bytes, str]

ROLE_LABELS: dict[MembershipRole, str] = {
    MembershipRole.OWNER: "مالك الحساب",
    MembershipRole.ADMIN: "مدير النظام",
    MembershipRole.BRANCH_ADMIN: "أدمن الفرع",
    MembershipRole.MANAGER: "مشرف",
    MembershipRole.AGENT: "موظف",
    MembershipRole.VIEWER: "مشاهد",
}


def is_brevo_configured() -> bool:
    return bool(settings.brevo_api_key and settings.smtp_from_email)


def is_smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from_email)


def is_email_configured() -> bool:
    return is_brevo_configured() or is_smtp_configured()


def build_invitation_accept_url(token: str) -> str:
    base = settings.app_public_url.rstrip("/")
    query = urlencode({"token": token})
    return f"{base}/invite?{query}"


def _sender_payload() -> dict[str, str]:
    from_email = settings.smtp_from_email or ""
    from_name = settings.smtp_from_name.strip() or "Watesly"
    return {"email": from_email, "name": from_name}


async def _send_via_brevo_api(
    *,
    to: str,
    subject: str,
    text_body: str,
    html_body: str,
    attachments: list[EmailAttachment] | None = None,
) -> None:
    api_key = settings.brevo_api_key.get_secret_value() if settings.brevo_api_key else None
    if not api_key:
        raise RuntimeError("Brevo API key is not configured")

    payload: dict[str, Any] = {
        "sender": _sender_payload(),
        "to": [{"email": to}],
        "subject": subject,
        "textContent": text_body,
        "htmlContent": html_body,
    }
    if attachments:
        payload["attachment"] = [
            {
                "content": base64.b64encode(content).decode("ascii"),
                "name": filename,
            }
            for filename, content, _mime in attachments
        ]
    async with httpx.AsyncClient(timeout=settings.smtp_timeout_seconds) as client:
        response = await client.post(
            BREVO_API_URL,
            headers={
                "accept": "application/json",
                "content-type": "application/json",
                "api-key": api_key,
            },
            json=payload,
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Brevo API error {response.status_code}: {response.text[:500]}")


def _send_email_smtp_sync(
    *,
    to: str,
    subject: str,
    text_body: str,
    html_body: str,
    attachments: list[EmailAttachment] | None = None,
) -> None:
    if not is_smtp_configured():
        raise RuntimeError("SMTP is not configured")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = _format_from_address()
    message["To"] = to
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    for filename, content, mime_type in attachments or []:
        maintype, _, subtype = mime_type.partition("/")
        message.add_attachment(content, maintype=maintype, subtype=subtype or "octet-stream", filename=filename)

    host = settings.smtp_host or ""
    port = settings.smtp_port
    username = settings.smtp_username
    password = settings.smtp_password.get_secret_value() if settings.smtp_password else None

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=settings.smtp_timeout_seconds) as client:
            if username and password:
                client.login(username, password)
            client.send_message(message)
        return

    with smtplib.SMTP(host, port, timeout=settings.smtp_timeout_seconds) as client:
        if settings.smtp_use_tls:
            client.starttls()
        if username and password:
            client.login(username, password)
        client.send_message(message)


def _format_from_address() -> str:
    sender = _sender_payload()
    return f"{sender['name']} <{sender['email']}>"


async def send_email(
    *,
    to: str,
    subject: str,
    text_body: str,
    html_body: str,
    attachments: list[EmailAttachment] | None = None,
) -> None:
    if is_brevo_configured():
        await _send_via_brevo_api(
            to=to,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            attachments=attachments,
        )
        return
    await asyncio.to_thread(
        _send_email_smtp_sync,
        to=to,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        attachments=attachments,
    )


async def send_team_invitation_email(
    *,
    to: str,
    invite_url: str,
    expires_hours: int,
    account_name: str,
    role: MembershipRole,
) -> bool:
    if not is_email_configured():
        return False

    role_label = ROLE_LABELS.get(role, str(role))
    subject = f"دعوة للانضمام إلى {account_name} على Watesly"
    text_body = (
        f"مرحباً،\n\n"
        f"تمت دعوتك للانضمام إلى فريق {account_name} على Watesly بدور {role_label}.\n"
        f"اضغط الرابط التالي لإعداد كلمة المرور وتفعيل حسابك:\n\n"
        f"{invite_url}\n\n"
        f"الرابط صالح لمدة {expires_hours} ساعة.\n"
        f"إذا لم تكن تتوقع هذه الدعوة، تجاهل هذه الرسالة.\n"
    )
    html_body = f"""\
<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <body style="font-family:Arial,sans-serif;line-height:1.7;color:#111b21;background:#f6faf8;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6ece9;border-radius:16px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:22px;color:#075e54;">دعوة للانضمام إلى Watesly</h1>
      <p style="margin:0 0 16px;">تمت دعوتك للانضمام إلى فريق <strong>{account_name}</strong> بدور <strong>{role_label}</strong>.</p>
      <p style="margin:0 0 20px;">اضغط الزر أدناه لإعداد كلمة المرور وتفعيل حسابك:</p>
      <p style="margin:0 0 24px;">
        <a href="{invite_url}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;">
          تفعيل الحساب
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#667781;">الرابط صالح لمدة {expires_hours} ساعة.</p>
      <p style="margin:0;font-size:12px;color:#667781;word-break:break-all;" dir="ltr">{invite_url}</p>
    </div>
  </body>
</html>
"""

    try:
        await send_email(to=to, subject=subject, text_body=text_body, html_body=html_body)
        return True
    except Exception:
        logger.exception("Failed to send team invitation email to %s", to)
        return False
