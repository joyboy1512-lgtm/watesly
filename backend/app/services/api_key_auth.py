import hashlib
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def touch_api_key(db: AsyncSession, *, api_key: ApiKey) -> None:
    api_key.last_used_at = datetime.now(UTC)
    api_key.request_count = int(getattr(api_key, "request_count", 0) or 0) + 1
    await db.commit()
