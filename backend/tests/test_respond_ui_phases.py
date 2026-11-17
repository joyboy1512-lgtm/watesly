"""Smoke checks for Respond-style UI backend additions."""

from app.models.channel import ChannelType
from app.schemas.custom_inbox import CustomInboxCreateRequest, CustomInboxFilters


def test_channel_types_include_omnichannel_scaffold():
    assert ChannelType.EMAIL.value == "email"
    assert ChannelType.SMS.value == "sms"
    assert ChannelType.WEB_CHAT.value == "web_chat"


def test_custom_inbox_filters_schema():
    payload = CustomInboxCreateRequest(
        name="VIP waiting",
        filters=CustomInboxFilters(needs_reply=True, starred=True, channel_type="whatsapp"),
    )
    dumped = payload.filters.model_dump(mode="json")
    assert dumped["needs_reply"] is True
    assert dumped["starred"] is True
    assert dumped["channel_type"] == "whatsapp"
