from unittest.mock import AsyncMock

import pytest

from app.models.membership import MembershipRole
from app.services import email as email_service


def test_build_invitation_accept_url_encodes_token(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "app_public_url", "https://www.watesly.com")
    url = email_service.build_invitation_accept_url("abc.def+ghi")
    assert url.startswith("https://www.watesly.com/invite?")
    assert "token=abc.def%2Bghi" in url


def test_is_brevo_configured_requires_api_key_and_from(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "brevo_api_key", None)
    monkeypatch.setattr(email_service.settings, "smtp_from_email", "info@watesly.com")
    assert email_service.is_brevo_configured() is False

    monkeypatch.setattr(email_service.settings, "brevo_api_key", "xkeysib-test")
    assert email_service.is_brevo_configured() is True


def test_is_email_configured_accepts_brevo_or_smtp(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "brevo_api_key", "xkeysib-test")
    monkeypatch.setattr(email_service.settings, "smtp_host", None)
    monkeypatch.setattr(email_service.settings, "smtp_from_email", "info@watesly.com")
    assert email_service.is_email_configured() is True

    monkeypatch.setattr(email_service.settings, "brevo_api_key", None)
    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp-relay.brevo.com")
    assert email_service.is_email_configured() is True


def test_is_smtp_configured_requires_host_and_from(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "smtp_host", None)
    monkeypatch.setattr(email_service.settings, "smtp_from_email", "noreply@watesly.com")
    assert email_service.is_smtp_configured() is False

    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(email_service.settings, "smtp_from_email", None)
    assert email_service.is_smtp_configured() is False

    monkeypatch.setattr(email_service.settings, "smtp_from_email", "noreply@watesly.com")
    assert email_service.is_smtp_configured() is True


@pytest.mark.asyncio
async def test_send_team_invitation_email_returns_false_when_email_disabled(monkeypatch) -> None:
    monkeypatch.setattr(email_service, "is_email_configured", lambda: False)
    sent = await email_service.send_team_invitation_email(
        to="agent@example.com",
        invite_url="https://www.watesly.com/invite?token=test",
        expires_hours=72,
        account_name="Watesly Demo",
        role=MembershipRole.AGENT,
    )
    assert sent is False


@pytest.mark.asyncio
async def test_send_team_invitation_email_uses_brevo_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(email_service, "is_email_configured", lambda: True)
    monkeypatch.setattr(email_service, "is_brevo_configured", lambda: True)
    monkeypatch.setattr(email_service, "send_email", AsyncMock(return_value=None))
    sent = await email_service.send_team_invitation_email(
        to="agent@example.com",
        invite_url="https://www.watesly.com/invite?token=test",
        expires_hours=72,
        account_name="Watesly Demo",
        role=MembershipRole.AGENT,
    )
    assert sent is True


@pytest.mark.asyncio
async def test_send_team_invitation_email_returns_false_on_failure(monkeypatch) -> None:
    monkeypatch.setattr(email_service, "is_email_configured", lambda: True)
    monkeypatch.setattr(
        email_service,
        "send_email",
        AsyncMock(side_effect=RuntimeError("brevo down")),
    )
    sent = await email_service.send_team_invitation_email(
        to="agent@example.com",
        invite_url="https://www.watesly.com/invite?token=test",
        expires_hours=72,
        account_name="Watesly Demo",
        role=MembershipRole.AGENT,
    )
    assert sent is False
