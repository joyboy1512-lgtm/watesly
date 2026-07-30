from cryptography.fernet import Fernet

from app.core.config import settings


wrapper = Fernet(settings.data_key_encryption_key.get_secret_value().encode("utf-8"))


def generate_account_data_key() -> bytes:
    return Fernet.generate_key()


def wrap_account_data_key(raw_key: bytes) -> str:
    return wrapper.encrypt(raw_key).decode("utf-8")


def unwrap_account_data_key(encrypted_key: str) -> bytes:
    return wrapper.decrypt(encrypted_key.encode("utf-8"))


def encrypt_for_account(raw_key: bytes, value: str) -> str:
    return Fernet(raw_key).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_for_account(raw_key: bytes, value: str) -> str:
    return Fernet(raw_key).decrypt(value.encode("utf-8")).decode("utf-8")
