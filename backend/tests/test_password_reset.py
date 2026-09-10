from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import jwt
import pytest

from app.core.config import settings
from app.core.security import (
    create_password_reset_token,
    decode_password_reset_token,
    hash_password,
    verify_password,
)
from app.models.user import User, UserStatus
from app.services import email as email_service
from app.services.auth import (
    FORGOT_PASSWORD_GENERIC_MESSAGE,
    request_password_reset,
    reset_password_with_token,
)


def test_password_reset_token_roundtrip() -> None:
    user_id = uuid4()
    changed_at = datetime.now(UTC)
    token = create_password_reset_token(user_id=user_id, password_changed_at=changed_at)
    decoded_id, pwd = decode_password_reset_token(token)
    assert decoded_id == user_id
    assert pwd == int(changed_at.timestamp())


def test_password_reset_token_rejects_wrong_type() -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": str(uuid4()),
            "pwd": 0,
            "iat": now,
            "exp": now + timedelta(hours=1),
            "type": "invitation",
        },
        settings.app_secret_key.get_secret_value(),
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidTokenError):
        decode_password_reset_token(token)


def test_build_password_reset_url_encodes_token(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "app_public_url", "https://www.watesly.com")
    url = email_service.build_password_reset_url("abc.def+ghi")
    assert url.startswith("https://www.watesly.com/reset-password?")
    assert "token=abc.def%2Bghi" in url


@pytest.mark.asyncio
async def test_send_password_reset_email_returns_false_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(email_service, "is_email_configured", lambda: False)
    sent = await email_service.send_password_reset_email(
        to="user@example.com",
        reset_url="https://www.watesly.com/reset-password?token=test",
        expires_hours=1,
        full_name="Test User",
    )
    assert sent is False


@pytest.mark.asyncio
async def test_send_password_reset_email_sends_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(email_service, "is_email_configured", lambda: True)
    send_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(email_service, "send_email", send_mock)
    sent = await email_service.send_password_reset_email(
        to="user@example.com",
        reset_url="https://www.watesly.com/reset-password?token=test",
        expires_hours=1,
        full_name="Test User",
    )
    assert sent is True
    send_mock.assert_awaited_once()
    kwargs = send_mock.await_args.kwargs
    assert kwargs["to"] == "user@example.com"
    assert "reset-password" in kwargs["text_body"]


@pytest.mark.asyncio
async def test_request_password_reset_unknown_email_is_silent(monkeypatch) -> None:
    db = AsyncMock()
    monkeypatch.setattr("app.services.auth.get_user_by_email", AsyncMock(return_value=None))
    send_mock = AsyncMock(return_value=True)
    monkeypatch.setattr("app.services.auth.send_password_reset_email", send_mock)
    sent = await request_password_reset(db, email="missing@example.com")
    assert sent is False
    send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_request_password_reset_sends_for_active_user(monkeypatch) -> None:
    user = User(
        email="owner@example.com",
        full_name="Owner",
        password_hash=hash_password("old-password"),
        preferred_language="ar",
        status=UserStatus.ACTIVE,
        password_changed_at=datetime.now(UTC),
    )
    user.id = uuid4()
    db = AsyncMock()
    monkeypatch.setattr("app.services.auth.get_user_by_email", AsyncMock(return_value=user))
    send_mock = AsyncMock(return_value=True)
    monkeypatch.setattr("app.services.auth.send_password_reset_email", send_mock)
    monkeypatch.setattr(
        "app.services.auth.build_password_reset_url",
        lambda token: f"https://www.watesly.com/reset-password?token={token}",
    )
    sent = await request_password_reset(db, email="owner@example.com")
    assert sent is True
    send_mock.assert_awaited_once()
    assert FORGOT_PASSWORD_GENERIC_MESSAGE


@pytest.mark.asyncio
async def test_reset_password_with_token_updates_hash_and_revokes(monkeypatch) -> None:
    changed_at = datetime.now(UTC) - timedelta(days=1)
    user = User(
        email="owner@example.com",
        full_name="Owner",
        password_hash=hash_password("old-password"),
        preferred_language="ar",
        status=UserStatus.ACTIVE,
        password_changed_at=changed_at,
        failed_login_attempts=3,
        locked_until=datetime.now(UTC) + timedelta(minutes=10),
    )
    user.id = uuid4()
    token = create_password_reset_token(user_id=user.id, password_changed_at=changed_at)

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
    revoke_mock = AsyncMock(return_value=1)
    monkeypatch.setattr("app.services.auth.revoke_all_user_sessions", revoke_mock)

    await reset_password_with_token(db, token=token, password="new-password-99")

    assert verify_password("new-password-99", user.password_hash)
    assert user.failed_login_attempts == 0
    assert user.locked_until is None
    assert user.password_changed_at is not None
    assert int(user.password_changed_at.timestamp()) != int(changed_at.timestamp())
    revoke_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_reset_password_rejects_stale_token_after_password_change() -> None:
    changed_at = datetime.now(UTC) - timedelta(days=1)
    user = User(
        email="owner@example.com",
        full_name="Owner",
        password_hash=hash_password("old-password"),
        preferred_language="ar",
        status=UserStatus.ACTIVE,
        password_changed_at=datetime.now(UTC),
    )
    user.id = uuid4()
    stale_token = create_password_reset_token(user_id=user.id, password_changed_at=changed_at)

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)

    with pytest.raises(ValueError, match="INVALID_OR_EXPIRED_TOKEN"):
        await reset_password_with_token(db, token=stale_token, password="new-password-99")
