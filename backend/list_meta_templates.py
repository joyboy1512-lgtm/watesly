"""List Meta-approved templates for WABA."""
import asyncio

from sqlalchemy import select

from app.core.encryption import decrypt_secret
from app.db.session import AsyncSessionFactory
from app.models.whatsapp_account import WhatsAppAccount
from app.services.meta_client import MetaWhatsAppClient


async def main() -> None:
    async with AsyncSessionFactory() as db:
        wa = (await db.execute(select(WhatsAppAccount))).scalar_one()
        client = MetaWhatsAppClient(
            access_token=decrypt_secret(wa.access_token_encrypted),
            phone_number_id=wa.phone_number_id,
        )
        try:
            data = await client.list_templates(waba_id=wa.waba_id, limit=100)
            for item in data.get("data", []):
                print(item.get("name"), item.get("language"), item.get("status"), item.get("category"))
        finally:
            await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
