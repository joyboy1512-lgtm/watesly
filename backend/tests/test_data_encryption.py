from cryptography.fernet import Fernet

from app.core.data_encryption import (
    decrypt_for_account,
    encrypt_for_account,
)


def test_account_data_encryption_round_trip() -> None:
    key = Fernet.generate_key()
    encrypted = encrypt_for_account(key, "sensitive customer data")
    assert encrypted != "sensitive customer data"
    assert decrypt_for_account(key, encrypted) == "sensitive customer data"
