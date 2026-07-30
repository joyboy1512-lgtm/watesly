from __future__ import annotations

import inspect
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable
from uuid import UUID, uuid4

from app.realtime.event_bus import publish_event

EventHandler = Callable[["DomainEvent"], Awaitable[None] | None]


@dataclass(slots=True)
class DomainEvent:
    name: str
    account_id: UUID
    payload: dict[str, Any]
    actor_user_id: UUID | None = None
    aggregate_type: str | None = None
    aggregate_id: str | None = None
    correlation_id: UUID = field(default_factory=uuid4)
    event_id: UUID = field(default_factory=uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    version: int = 1

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        for key in ("account_id", "actor_user_id", "correlation_id", "event_id"):
            if data.get(key) is not None:
                data[key] = str(data[key])
        data["occurred_at"] = self.occurred_at.isoformat()
        return data


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = defaultdict(list)

    def subscribe(self, event_name: str, handler: EventHandler) -> None:
        if handler not in self._handlers[event_name]:
            self._handlers[event_name].append(handler)

    async def publish(self, event: DomainEvent) -> None:
        for handler in self._handlers.get(event.name, []):
            result = handler(event)
            if inspect.isawaitable(result):
                await result

        for handler in self._handlers.get("*", []):
            result = handler(event)
            if inspect.isawaitable(result):
                await result

        await publish_event(
            event.account_id,
            {
                "type": "domain.event",
                "event": event.to_dict(),
            },
        )


event_bus = EventBus()
