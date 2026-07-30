from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Generic, TypeVar
from uuid import UUID, uuid4

T = TypeVar("T")
QueryHandler = Callable[["Query[Any]"], Awaitable[Any] | Any]


@dataclass(slots=True)
class Query(Generic[T]):
    name: str
    account_id: UUID
    filters: dict[str, Any]
    actor_user_id: UUID | None = None
    correlation_id: UUID = field(default_factory=uuid4)


class QueryBus:
    def __init__(self) -> None:
        self._handlers: dict[str, QueryHandler] = {}

    def register(self, query_name: str, handler: QueryHandler) -> None:
        if query_name in self._handlers:
            raise ValueError(f"Query handler already registered: {query_name}")
        self._handlers[query_name] = handler

    async def execute(self, query: Query[T]) -> T:
        handler = self._handlers.get(query.name)
        if handler is None:
            raise ValueError(f"No handler registered for query: {query.name}")
        result = handler(query)
        if inspect.isawaitable(result):
            return await result
        return result


query_bus = QueryBus()
