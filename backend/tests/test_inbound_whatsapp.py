from pathlib import Path

ROOT = Path(__file__).parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_inbound_messages_persist_before_side_effects() -> None:
    inbound = read("app/services/inbound_whatsapp.py")
    whatsapp = read("app/services/whatsapp.py")
    assert "async def persist_inbound_message" in inbound
    assert "async def process_inbound_side_effects" in inbound
    assert "publish_inbound_message_event" in inbound
    assert "persist_inbound_message(" in whatsapp
    assert "process_inbound_side_effects(" in whatsapp
    assert '"type": "message.received"' in inbound


def test_inbound_side_effects_are_isolated() -> None:
    inbound = read("app/services/inbound_whatsapp.py")
    assert inbound.count("logger.exception") >= 5
    assert "Inbound AI side effects failed" in inbound
