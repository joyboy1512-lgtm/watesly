from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID
import jwt
from pwdlib import PasswordHash
from app.core.config import settings

ALGORITHM = "HS256"
password_hash = PasswordHash.recommended()

def hash_password(password: str) -> str: return password_hash.hash(password)
def verify_password(password: str, hashed_password: str) -> bool: return password_hash.verify(password, hashed_password)

def create_access_token(*, user_id: UUID, account_id: UUID, session_id: UUID | None = None, password_changed_at: datetime | None = None) -> str:
    now = datetime.now(UTC); expires_at = now + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub":str(user_id),"account_id":str(account_id),"sid":str(session_id or UUID(int=0)),"pwd":int(password_changed_at.timestamp()) if password_changed_at else 0,"iat":now,"exp":expires_at,"type":"access"}, settings.app_secret_key.get_secret_value(), algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.app_secret_key.get_secret_value(), algorithms=[ALGORITHM])
def create_refresh_token_value() -> str: return token_urlsafe(48)
def hash_opaque_token(token: str) -> str: return sha256(token.encode()).hexdigest()
def create_invitation_token(*, invitation_id: UUID) -> str:
    now=datetime.now(UTC); return jwt.encode({"sub":str(invitation_id),"iat":now,"exp":now+timedelta(hours=settings.invitation_token_expire_hours),"type":"invitation"}, settings.app_secret_key.get_secret_value(), algorithm=ALGORITHM)
def decode_invitation_token(token: str) -> UUID:
    payload=jwt.decode(token,settings.app_secret_key.get_secret_value(),algorithms=[ALGORITHM]);
    if payload.get("type")!="invitation": raise jwt.InvalidTokenError("Wrong token type")
    return UUID(payload["sub"])
