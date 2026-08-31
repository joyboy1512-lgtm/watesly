"""Meta Instagram Messaging Graph client (Page-linked Instagram Professional)."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings
from app.services.meta_client import MetaAPIError


class MetaInstagramClient:
    """Send/receive via Graph API using a Facebook Page access token."""

    def __init__(self, *, access_token: str, page_id: str, ig_user_id: str | None = None) -> None:
        self.access_token = access_token
        self.page_id = page_id
        self.ig_user_id = ig_user_id
        self._client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    @property
    def _base(self) -> str:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        return f"{base}/{version}"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    async def _request(self, method: str, url: str, **kwargs: Any) -> dict:
        client = self._get_client()
        response = await client.request(method, url, headers=self._headers(), **kwargs)
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        if response.is_error:
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Meta Instagram API request failed"),
                status_code=response.status_code,
                response_data=data,
            )
        return data if isinstance(data, dict) else {"data": data}

    async def get_page_instagram_profile(self) -> dict:
        """Resolve Instagram Business Account linked to the Page."""
        url = f"{self._base}/{self.page_id}"
        params = {
            "fields": "id,name,instagram_business_account{id,username,name}",
        }
        return await self._request("GET", url, params=params)

    async def send_text(self, *, to: str, text: str) -> dict:
        """Send Instagram DM text to an IGSID via Page messages endpoint."""
        url = f"{self._base}/{self.page_id}/messages"
        payload = {
            "recipient": {"id": to},
            "messaging_type": "RESPONSE",
            "message": {"text": text},
        }
        return await self._request("POST", url, json=payload)

    async def subscribe_page_webhooks(self) -> dict:
        """Subscribe the Page to messaging webhook fields (Instagram + Messenger)."""
        url = f"{self._base}/{self.page_id}/subscribed_apps"
        params = {
            "subscribed_fields": ",".join(
                [
                    "messages",
                    "messaging_postbacks",
                    "message_echoes",
                    "messaging_seen",
                    "standby",
                ]
            )
        }
        return await self._request("POST", url, params=params)

    async def get_user_profile(self, igsid: str) -> dict:
        url = f"{self._base}/{igsid}"
        params = {"fields": "name,username,profile_pic"}
        try:
            return await self._request("GET", url, params=params)
        except MetaAPIError:
            return {}
