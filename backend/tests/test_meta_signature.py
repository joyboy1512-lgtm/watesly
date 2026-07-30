import hashlib
import hmac

from app.core.config import settings
from app.core.meta_security import verify_meta_signature


def test_meta_signature_verification() -> None:
    body = b'{"object":"whatsapp_business_account"}'
    secret = settings.meta_app_secret.get_secret_value().encode("utf-8")
    digest = hmac.new(secret, body, hashlib.sha256).hexdigest()

    assert verify_meta_signature(body, f"sha256={digest}")
    assert not verify_meta_signature(body, "sha256=invalid")
