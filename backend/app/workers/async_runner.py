"""Run async coroutines safely inside Celery prefork workers."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any, TypeVar

T = TypeVar("T")


def _reset_async_pools() -> None:
    """Invalidate DB/Redis pools bound to a previous event loop."""
    from app.core.redis import reset_redis_client
    from app.db.session import engine

    engine.sync_engine.dispose(close=False)
    reset_redis_client()


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    """Fresh event loop + dispose DB/Redis pools — avoids loop mismatch in prefork workers."""
    _reset_async_pools()

    async def _run() -> T:
        from app.core.redis import dispose_redis_client
        from app.db.session import engine

        try:
            return await coro
        finally:
            await engine.dispose()
            await dispose_redis_client()

    return asyncio.run(_run())
