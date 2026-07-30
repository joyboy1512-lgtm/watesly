from uuid import uuid4

from app.core_engine.events import DomainEvent


def test_domain_event_serialization() -> None:
    event = DomainEvent(
        name="MessageReceived",
        account_id=uuid4(),
        payload={"message_id": "123"},
    )
    data = event.to_dict()
    assert data["name"] == "MessageReceived"
    assert data["payload"]["message_id"] == "123"
    assert isinstance(data["event_id"], str)
