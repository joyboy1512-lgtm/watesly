from uuid import uuid4
import pytest
from app.core_engine.commands import Command, CommandBus

@pytest.mark.asyncio
async def test_non_idempotent_command_still_dispatches() -> None:
    bus = CommandBus(); bus.register("Ping", lambda command: {"pong": command.payload["value"]})
    result = await bus.dispatch(Command(name="Ping", account_id=uuid4(), payload={"value": 1}))
    assert result == {"pong": 1}

@pytest.mark.asyncio
async def test_idempotent_command_requires_db() -> None:
    bus = CommandBus(); bus.register("Ping", lambda command: "pong")
    with pytest.raises(ValueError, match="DB_SESSION_REQUIRED"):
        await bus.dispatch(Command(name="Ping", account_id=uuid4(), payload={}, idempotency_key="same"))
