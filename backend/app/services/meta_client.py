from typing import Any

import httpx

from app.core.config import settings


class MetaAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int, response_data: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_data = response_data


class MetaWhatsAppClient:
    def __init__(self, *, access_token: str, phone_number_id: str) -> None:
        self.access_token = access_token
        self.phone_number_id = phone_number_id
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
    def messages_url(self) -> str:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        return f"{base}/{version}/{self.phone_number_id}/messages"



    async def list_templates(self, *, waba_id: str, limit: int = 100) -> dict:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/{waba_id}/message_templates"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        params = {"limit": limit}

        client = self._get_client()
        response = await client.get(url, headers=headers, params=params)

        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}

        if response.is_error:
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Unable to fetch WhatsApp templates"),
                status_code=response.status_code,
                response_data=data,
            )
        return data

    async def get_phone_number_health(self) -> dict:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/{self.phone_number_id}"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        params = {
            "fields": "display_phone_number,verified_name,quality_rating,messaging_limit_tier,status",
        }
        client = self._get_client()
        response = await client.get(url, headers=headers, params=params)
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        if response.is_error:
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Unable to fetch phone number health"),
                status_code=response.status_code,
                response_data=data,
            )
        return data if isinstance(data, dict) else {}

    @staticmethod
    async def _parse_graph_response(response: httpx.Response, *, default_message: str) -> dict:
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        if response.is_error or not isinstance(data, dict):
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", default_message) if isinstance(error, dict) else default_message,
                status_code=response.status_code,
                response_data=data,
            )
        return data

    @staticmethod
    def _app_access_token() -> str:
        if not settings.meta_app_id:
            raise MetaAPIError("Meta App ID is not configured", status_code=400)
        return f"{settings.meta_app_id}|{settings.meta_app_secret.get_secret_value()}"

    @staticmethod
    async def exchange_for_long_lived_token(*, short_lived_token: str) -> str:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/oauth/access_token"
        params = {
            "grant_type": "fb_exchange_token",
            "client_id": settings.meta_app_id,
            "client_secret": settings.meta_app_secret.get_secret_value(),
            "fb_exchange_token": short_lived_token,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, params=params)
        data = await MetaWhatsAppClient._parse_graph_response(
            response, default_message="Unable to exchange for long-lived token"
        )
        token = data.get("access_token")
        if not token:
            raise MetaAPIError(
                "Long-lived access token missing from Meta response",
                status_code=502,
                response_data=data,
            )
        return str(token)

    @staticmethod
    async def exchange_oauth_code(*, code: str) -> str:
        if not settings.meta_app_id:
            raise MetaAPIError("Meta App ID is not configured", status_code=400)
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/oauth/access_token"
        params = {
            "client_id": settings.meta_app_id,
            "client_secret": settings.meta_app_secret.get_secret_value(),
            "code": code,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(url, params=params)
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        data = await MetaWhatsAppClient._parse_graph_response(
            response, default_message="Unable to exchange OAuth code"
        )
        short_lived = str(data["access_token"])
        try:
            return await MetaWhatsAppClient.exchange_for_long_lived_token(short_lived_token=short_lived)
        except MetaAPIError:
            return short_lived

    async def list_waba_phone_numbers(self, *, waba_id: str) -> list[dict]:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/{waba_id}/phone_numbers"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        client = self._get_client()
        response = await client.get(url, headers=headers)
        data = await self._parse_graph_response(
            response, default_message="Unable to list WABA phone numbers"
        )
        rows = data.get("data", [])
        return [row for row in rows if isinstance(row, dict)]

    async def get_waba_webhook_subscriptions(self, *, waba_id: str) -> list[dict]:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/{waba_id}/subscribed_apps"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        client = self._get_client()
        response = await client.get(url, headers=headers)
        data = await self._parse_graph_response(
            response, default_message="Unable to fetch WABA webhook subscriptions"
        )
        rows = data.get("data", [])
        return [row for row in rows if isinstance(row, dict)]

    async def subscribe_waba_webhooks(
        self,
        *,
        waba_id: str,
        callback_url: str,
        verify_token: str,
    ) -> dict:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        client = self._get_client()
        headers = {"Authorization": f"Bearer {self.access_token}"}
        app_id = settings.meta_app_id
        if app_id:
            app_token = self._app_access_token()
            sub_url = f"{base}/{version}/{app_id}/subscriptions"
            sub_response = await client.post(
                sub_url,
                data={
                    "object": "whatsapp_business_account",
                    "callback_url": callback_url,
                    "verify_token": verify_token,
                    "fields": "messages,message_template_status_update",
                    "include_values": "true",
                    "access_token": app_token,
                },
            )
            if sub_response.is_error:
                try:
                    sub_data = sub_response.json()
                except ValueError:
                    sub_data = {"raw": sub_response.text}
                error = sub_data.get("error", {}) if isinstance(sub_data, dict) else {}
                if not (isinstance(error, dict) and error.get("error_subcode") == 1929002):
                    await self._parse_graph_response(
                        sub_response, default_message="Unable to configure app webhook subscription"
                    )
        waba_url = f"{base}/{version}/{waba_id}/subscribed_apps"
        response = await client.post(waba_url, headers=headers)
        return await self._parse_graph_response(
            response, default_message="Unable to subscribe WABA to app webhooks"
        )

    async def _send_payload(self, payload: dict) -> dict:
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        client = self._get_client()
        response = await client.post(self.messages_url, headers=headers, json=payload)

        try:
            response_data = response.json()
        except ValueError:
            response_data = {"raw": response.text}

        if response.is_error:
            error = response_data.get("error", {}) if isinstance(response_data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Meta WhatsApp API request failed"),
                status_code=response.status_code,
                response_data=response_data,
            )
        return response_data

    async def send_media(
        self,
        *,
        to: str,
        media_type: str,
        media_url: str,
        caption: str | None = None,
        filename: str | None = None,
    ) -> dict:
        media_object: dict = {"link": media_url}
        if caption and media_type in {"image", "video", "document"}:
            media_object["caption"] = caption
        if filename and media_type == "document":
            media_object["filename"] = filename

        return await self._send_payload(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": media_type,
                media_type: media_object,
            }
        )

    async def send_template(
        self,
        *,
        to: str,
        template_name: str,
        language_code: str,
        components: list[dict],
    ) -> dict:
        return await self._send_payload(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {"code": language_code},
                    "components": components,
                },
            }
        )

    async def send_text(
        self,
        *,
        to: str,
        text: str,
        preview_url: bool = False,
    ) -> dict:
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {
                "preview_url": preview_url,
                "body": text,
            },
        }
        return await self._send_payload(payload)

    async def send_single_product(
        self,
        *,
        to: str,
        catalog_id: str,
        product_retailer_id: str,
        body: str,
        footer: str | None = None,
    ) -> dict:
        interactive: dict = {
            "type": "product",
            "body": {"text": body[:1024]},
            "action": {
                "catalog_id": catalog_id,
                "product_retailer_id": product_retailer_id,
            },
        }
        if footer:
            interactive["footer"] = {"text": footer[:60]}
        return await self._send_payload(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "interactive",
                "interactive": interactive,
            }
        )

    async def send_product_list(
        self,
        *,
        to: str,
        catalog_id: str,
        sections: list[dict],
        body: str,
        header: str | None = None,
        footer: str | None = None,
    ) -> dict:
        interactive: dict = {
            "type": "product_list",
            "body": {"text": body[:1024]},
            "action": {
                "catalog_id": catalog_id,
                "sections": sections,
            },
        }
        if header:
            interactive["header"] = {"type": "text", "text": header[:60]}
        if footer:
            interactive["footer"] = {"text": footer[:60]}
        return await self._send_payload(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "interactive",
                "interactive": interactive,
            }
        )

    async def get_media_metadata(self, media_id: str) -> dict:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/{media_id}"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        client = self._get_client()
        response = await client.get(url, headers=headers)
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        if response.is_error:
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Unable to fetch WhatsApp media metadata"),
                status_code=response.status_code,
                response_data=data,
            )
        return data if isinstance(data, dict) else {}

    async def download_media(self, media_id: str) -> tuple[bytes, str, str | None]:
        metadata = await self.get_media_metadata(media_id)
        download_url = metadata.get("url")
        if not download_url:
            raise MetaAPIError(
                "WhatsApp media download URL is missing",
                status_code=502,
                response_data=metadata,
            )

        mime_type = str(metadata.get("mime_type") or "application/octet-stream")
        headers = {"Authorization": f"Bearer {self.access_token}"}
        client = self._get_client()
        response = await client.get(download_url, headers=headers)
        if response.is_error:
            try:
                data = response.json()
            except ValueError:
                data = {"raw": response.text}
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Unable to download WhatsApp media"),
                status_code=response.status_code,
                response_data=data,
            )
        return response.content, mime_type, None

    async def upload_template_sample(
        self,
        *,
        file_name: str,
        file_bytes: bytes,
        mime_type: str,
    ) -> str:
        if not settings.meta_app_id:
            raise MetaAPIError("Meta App ID is not configured", status_code=400)

        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        app_id = settings.meta_app_id
        file_length = len(file_bytes)
        client = self._get_client()

        session_url = f"{base}/{version}/{app_id}/uploads"
        session_response = await client.post(
            session_url,
            params={
                "file_name": file_name,
                "file_length": file_length,
                "file_type": mime_type,
                "access_token": self.access_token,
            },
        )
        session_data = await self._parse_graph_response(
            session_response,
            default_message="Unable to start Meta template media upload",
        )
        session_id = session_data.get("id")
        if not session_id:
            raise MetaAPIError(
                "Meta upload session id missing",
                status_code=502,
                response_data=session_data,
            )

        upload_url = f"{base}/{version}/{session_id}"
        upload_response = await client.post(
            upload_url,
            headers={
                "Authorization": f"OAuth {self.access_token}",
                "file_offset": "0",
                "Content-Type": "application/octet-stream",
            },
            content=file_bytes,
        )
        handle_data = await self._parse_graph_response(
            upload_response,
            default_message="Unable to upload template media sample to Meta",
        )
        handle = handle_data.get("h")
        if not handle:
            raise MetaAPIError(
                "Meta template media handle missing",
                status_code=502,
                response_data=handle_data,
            )
        return str(handle)

    async def create_message_template(
        self,
        *,
        waba_id: str,
        name: str,
        language: str,
        category: str,
        components: list[dict],
    ) -> dict:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        url = f"{base}/{version}/{waba_id}/message_templates"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "name": name,
            "language": language,
            "category": category.upper(),
            "components": components,
        }
        client = self._get_client()
        response = await client.post(url, headers=headers, json=payload)
        return await self._parse_graph_response(
            response,
            default_message="Unable to create WhatsApp template in Meta",
        )

    async def debug_access_token(self) -> dict:
        base = settings.meta_graph_api_base_url.rstrip("/")
        version = settings.meta_graph_api_version.strip("/")
        app_token = f"{settings.meta_app_id}|{settings.meta_app_secret.get_secret_value()}"
        url = f"{base}/{version}/debug_token"
        params = {
            "input_token": self.access_token,
            "access_token": app_token,
        }
        client = self._get_client()
        response = await client.get(url, params=params)
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        if response.is_error:
            error = data.get("error", {}) if isinstance(data, dict) else {}
            raise MetaAPIError(
                error.get("message", "Unable to debug access token"),
                status_code=response.status_code,
                response_data=data,
            )
        return data if isinstance(data, dict) else {}
