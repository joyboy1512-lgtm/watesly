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
        from app.services.meta_instagram import MetaInstagramClient

        client: MetaInstagramClient = kwargs["client"]
        return await client.send_text(to=to, text=text)

    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        events: list[dict] = []
        for entry in payload.get("entry", []) or []:
            if not isinstance(entry, dict):
                continue
            messaging = entry.get("messaging") or []
            for item in messaging:
                if not isinstance(item, dict):
                    continue
                message = item.get("message") or {}
                if message.get("is_echo"):
                    continue
                events.append(
                    {
                        "channel_type": "instagram",
                        "ig_id": entry.get("id"),
                        "sender_id": (item.get("sender") or {}).get("id"),
                        "message": message,
                    }
                )
        return events


class MessengerChannelAdapter(ChannelAdapter):
    channel_type = "messenger"

    async def send_text(self, *, to: str, text: str, **kwargs: Any) -> dict:
        from app.services.meta_instagram import MetaInstagramClient

        client: MetaInstagramClient = kwargs["client"]
        return await client.send_text(to=to, text=text)

    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        events: list[dict] = []
        for entry in payload.get("entry", []) or []:
            if not isinstance(entry, dict):
                continue
            for item in entry.get("messaging") or []:
                if not isinstance(item, dict):
                    continue
                message = item.get("message") or {}
                if message.get("is_echo"):
                    continue
                events.append(
                    {
                        "channel_type": "messenger",
                        "page_id": entry.get("id"),
                        "sender_id": (item.get("sender") or {}).get("id"),
                        "message": message,
                    }
                )
        return events


class WebChatChannelAdapter(ChannelAdapter):
    channel_type = "web_chat"

    async def send_text(self, *, to: str, text: str, **kwargs: Any) -> dict:
        return {"status": "stored", "to": to, "text": text, "source": "web_chat"}

    async def parse_inbound_webhook(self, payload: dict) -> list[dict]:
        if not isinstance(payload, dict):
            return []
        text = str(payload.get("text") or "").strip()
        visitor_id = str(payload.get("visitor_id") or "").strip()
        if not text or not visitor_id:
            return []
        return [
            {
                "channel_type": "web_chat",
                "visitor_id": visitor_id,
                "text": text,
                "display_name": payload.get("display_name"),
            }
        ]


ADAPTERS: dict[str, ChannelAdapter] = {
    "whatsapp": WhatsAppChannelAdapter(),
    "instagram": InstagramChannelAdapter(),
    "messenger": MessengerChannelAdapter(),
    "web_chat": WebChatChannelAdapter(),
}


def get_adapter(channel_type: str) -> ChannelAdapter | None:
    return ADAPTERS.get(channel_type)
