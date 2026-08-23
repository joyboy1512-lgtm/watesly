from types import SimpleNamespace
from uuid import uuid4

from app.services.catalog import product_matches_conversation_channel


def test_product_matches_conversation_channel_unchanged_for_purge_context() -> None:
    channel_id = uuid4()
    product = SimpleNamespace(channel_id=channel_id)
    assert product_matches_conversation_channel(product, channel_id=channel_id) is True
