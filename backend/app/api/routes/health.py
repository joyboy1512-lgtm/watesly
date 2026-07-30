from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.db.session import get_db
from app.services.storage import storage

router = APIRouter()


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "alive"}


async def _dependency_status(db: AsyncSession) -> dict[str, str]:
    result = {"application": "ok", "database": "unknown", "redis": "unknown", "storage": "unknown"}
    try:
        await db.execute(text("SELECT 1")); result["database"] = "ok"
    except Exception as exc:
        result["database"] = f"error:{type(exc).__name__}"
    try:
        await redis_client.ping(); result["redis"] = "ok"
    except Exception as exc:
        result["redis"] = f"error:{type(exc).__name__}"
    try:
        result["storage"] = "ok" if storage.bucket_exists() else "error:bucket_unavailable"
    except Exception as exc:
        result["storage"] = f"error:{type(exc).__name__}"
    return result


@router.get("")
async def health_check(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    result = await _dependency_status(db)
    if any(value.startswith("error") for value in result.values()):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=result)
    return result


@router.get("/ready")
async def readiness(db: AsyncSession = Depends(get_db)) -> dict:
    result = await _dependency_status(db)
    if any(value.startswith("error") for value in result.values()):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=result)
    return {"status": "ready", "dependencies": result}


@router.get("/startup")
async def startup(db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(text("SELECT 1"))
    return {"status": "started"}
