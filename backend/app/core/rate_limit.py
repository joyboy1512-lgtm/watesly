from fastapi import HTTPException, Request
from app.core.redis import redis_client
async def enforce_rate_limit(request: Request, *, bucket: str, limit: int, window_seconds: int, identity: str | None = None) -> None:
    source=identity or (request.client.host if request.client else "unknown")
    key=f"ratelimit:{bucket}:{source}"
    count=await redis_client.incr(key)
    if count==1: await redis_client.expire(key,window_seconds)
    if count>limit: raise HTTPException(status_code=429,detail={"code":"RATE_LIMITED","retry_after":await redis_client.ttl(key)})
