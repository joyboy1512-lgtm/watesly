from redis.asyncio import Redis

from app.core.config import settings

_redis_client: Redis | None = None


def _create_redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)


def get_redis_client() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = _create_redis_client()
    return _redis_client


async def dispose_redis_client() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None


def reset_redis_client() -> None:
    """Drop cached client without awaiting — safe before a fresh event loop."""
    global _redis_client
    _redis_client = None


class _LazyRedis:
    def __getattr__(self, name: str):
        return getattr(get_redis_client(), name)


redis_client = _LazyRedis()
