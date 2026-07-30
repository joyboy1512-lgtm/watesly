from uuid import uuid4

import pytest

from app.core_engine.commands import Command, CommandBus
from app.core_engine.queries import Query, QueryBus


@pytest.mark.asyncio
async def test_command_bus_dispatches() -> None:
    bus = CommandBus()
    bus.register("Ping", lambda command: command.payload["value"])
    result = await bus.dispatch(
        Command(name="Ping", account_id=uuid4(), payload={"value": "pong"})
    )
    assert result == "pong"


@pytest.mark.asyncio
async def test_query_bus_executes() -> None:
    bus = QueryBus()
    bus.register("Count", lambda query: len(query.filters))
    result = await bus.execute(
        Query(name="Count", account_id=uuid4(), filters={"a": 1, "b": 2})
    )
    assert result == 2
