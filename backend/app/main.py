import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.middleware import SecurityHeadersMiddleware
from app.realtime.event_bus import listen_for_events
from app.services import event_handlers  # noqa: F401
from app.services.storage import storage


@asynccontextmanager
async def lifespan(_: FastAPI):
    storage.ensure_bucket()
    listener_task = asyncio.create_task(listen_for_events())
    try:
        yield
    finally:
        listener_task.cancel()
        try:
            await listener_task
        except asyncio.CancelledError:
            pass


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        debug=settings.app_debug,
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url="/redoc" if settings.app_env != "production" else None,
        lifespan=lifespan,
    )

    application.add_middleware(SecurityHeadersMiddleware)

    origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(api_router, prefix="/api/v1")
    return application


app = create_application()


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "status": "running",
        "version": settings.app_version,
    }
