from cryptography.fernet import Fernet
from secrets import token_urlsafe

print(f"APP_SECRET_KEY={token_urlsafe(48)}")
print(f"CREDENTIAL_ENCRYPTION_KEY={Fernet.generate_key().decode()}")
print(f"DATA_KEY_ENCRYPTION_KEY={Fernet.generate_key().decode()}")
print(f"META_WEBHOOK_VERIFY_TOKEN={token_urlsafe(32)}")
