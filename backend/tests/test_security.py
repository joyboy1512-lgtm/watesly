from uuid import uuid4

from app.core.security import create_access_token, hash_password, verify_password


def test_password_hashing() -> None:
    password = "StrongPassword123"
    hashed = hash_password(password)

    assert hashed != password
    assert verify_password(password, hashed)
    assert not verify_password("WrongPassword123", hashed)


def test_access_token_creation() -> None:
    token = create_access_token(user_id=uuid4(), account_id=uuid4())
    assert isinstance(token, str)
    assert token.count(".") == 2
