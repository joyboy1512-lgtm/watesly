import hashlib
import hmac

from app.core.config import settings


def verify_meta_signature(raw_body: bytes, signature_header: str | None) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False

    received_signature = signature_header.removeprefix("sha256=")
    expected_signature = hmac.new(
        settings.meta_app_secret.get_secret_value().encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(received_signature, expected_signature)
