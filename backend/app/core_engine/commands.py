from __future__ import annotations

import inspect
from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Awaitable, Callable, Generic, TypeVar
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.idempotency_record import IdempotencyStatus
from app.services.idempotency import complete, fail, reserve

T = TypeVar("T")
CommandHandler = Callable[["Command[Any]"], Awaitable[Any] | Any]


@dataclass(slots=True)
class Command(Generic[T]):
    name: str
    account_id: UUID
    payload: dict[str, Any]
    actor_user_id: UUID | None = None
    correlation_id: UUID = field(default_factory=uuid4)
    idempotency_key: str | None = None


def _serialize_result(value: Any) -> dict:
    if value is None:
        return {"value": None}
    if hasattr(value, "model_dump"):
        return {"value": value.model_dump(mode="json")}
    if is_dataclass(value):
        return {"value": asdict(value)}
    if isinstance(value, dict):
        return {"value": value}
    if isinstance(value, (str, int, float, bool, list)):
        return {"value": value}
    if hasattr(value, "id"):
        return {"resource_id": str(value.id)}
    return {"value": str(value)}


class CommandBus:
    def __init__(self) -> None:
        self._handlers: dict[str, CommandHandler] = {}

    def register(self, command_name: str, handler: CommandHandler) -> None:
        if command_name in self._handlers:
            raise ValueError(f"Command handler already registered: {command_name}")
        self._handlers[command_name] = handler

    async def dispatch(self, command: Command[T], *, db: AsyncSession | None = None) -> T:
        handler = self._handlers.get(command.name)
        if handler is None:
            raise ValueError(f"No handler registered for command: {command.name}")

        record = None
        if command.idempotency_key:
            if db is None:
                raise ValueError("DB_SESSION_REQUIRED_FOR_IDEMPOTENT_COMMAND")
            record, created = await reserve(db, account_id=command.account_id, command_name=command.name, key=command.idempotency_key, payload=command.payload)
            if not created:
                if record.status == IdempotencyStatus.COMPLETED:
                    return record.response_payload  # type: ignore[return-value]
                if record.status == IdempotencyStatus.PROCESSING:
                    raise ValueError("IDEMPOTENT_COMMAND_IN_PROGRESS")

        try:
            result = handler(command)
            if inspect.isawaitable(result):
                result = await result
            if record is not None and db is not None:
                await complete(db, record, _serialize_result(result))
            return result
        except Exception as exc:
            if record is not None and db is not None:
                await fail(db, record, str(exc))
            raise


command_bus = CommandBus()
