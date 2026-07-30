from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

fernet = Fernet(settings.credential_encryption_key.get_secret_value().encode("utf-8"))


def encrypt_secret(value: str) -> str:
    return fernet.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    try:
        return fernet.decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt stored credential") from exc
