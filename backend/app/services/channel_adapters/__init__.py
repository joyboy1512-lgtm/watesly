"""Unified channel adapter layer — WhatsApp today, Instagram/Messenger next."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ChannelAdapter(ABC):
    channel_type: str

    @abstractmethod
    async def send_text(self, *, to: str, text: str, **kwargs: Any) -> dict:
        raise NotImplementedError

    @abstractmethod
    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        raise NotImplementedError


class WhatsAppChannelAdapter(ChannelAdapter):
    channel_type = "whatsapp"

    async def send_text(self, *, to: str, text: str, **kwargs: Any) -> dict:
        from app.services.meta_client import MetaWhatsAppClient

        client: MetaWhatsAppClient = kwargs["client"]
        return await client.send_text(to=to, text=text)

    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        events: list[dict] = []
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                metadata = value.get("metadata", {})
                for item in value.get("messages", []):
                    events.append(
                        {
                            "channel_type": "whatsapp",
                            "phone_number_id": metadata.get("phone_number_id"),
                            "message": item,
                            "contacts": value.get("contacts", []),
                        }
                    )
        return events


class InstagramChannelAdapter(ChannelAdapter):
    channel_type = "instagram"

    async def send_text(self, *, to: str, text: str, **kwargs: Any) -> dict:
        raise NotImplementedError("Instagram adapter requires Meta channel setup")

    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        return []


class MessengerChannelAdapter(ChannelAdapter):
    channel_type = "messenger"

    async def send_text(self, *, to: str, text: str, **kwargs: Any) -> dict:
        raise NotImplementedError("Messenger adapter requires Meta channel setup")

    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        return []


ADAPTERS: dict[str, ChannelAdapter] = {
    "whatsapp": WhatsAppChannelAdapter(),
    "instagram": InstagramChannelAdapter(),
    "messenger": MessengerChannelAdapter(),
}


def get_adapter(channel_type: str) -> ChannelAdapter | None:
    return ADAPTERS.get(channel_type)
