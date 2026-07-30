from datetime import UTC, datetime
from uuid import uuid4

from app.core_engine.commands import Command
from app.models.module_health import ModuleHealthStatus
from app.services.idempotency import fingerprint


def test_command_accepts_idempotency_key() -> None:
    command = Command(name="SendMessage", account_id=uuid4(), payload={"text": "hello"}, idempotency_key="req-1")
    assert command.idempotency_key == "req-1"


def test_fingerprint_is_stable() -> None:
    assert fingerprint({"b": 2, "a": 1}) == fingerprint({"a": 1, "b": 2})


def test_health_states_include_deployment_states() -> None:
    assert ModuleHealthStatus.STALE == "stale"
    assert ModuleHealthStatus.DRAINING == "draining"
