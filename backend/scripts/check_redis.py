import asyncio
from app.core.config import settings
from app.core.redis import redis_client

async def main() -> None:
    print("redis_url=", settings.redis_url)
    print("ping=", await redis_client.ping())

asyncio.run(main())
