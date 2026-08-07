"""Check WhatsApp Meta API health for production account."""
import asyncio

from sqlalchemy import select

from app.core.encryption import decrypt_secret
from app.db.session import AsyncSessionFactory
from app.models.whatsapp_account import WhatsAppAccount
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient


async def main() -> None:
    async with AsyncSessionFactory() as db:
        wa = (await db.execute(select(WhatsAppAccount))).scalar_one()
        print("DB phone_number_id:", wa.phone_number_id)
        print("DB waba_id:", wa.waba_id)
        print("DB display:", wa.display_phone_number)
        print("DB status:", wa.status)
        client = MetaWhatsAppClient(
            access_token=decrypt_secret(wa.access_token_encrypted),
            phone_number_id=wa.phone_number_id,
        )
        try:
            health = await client.get_phone_number_health()
            print("HEALTH OK:", health)
        except MetaAPIError as exc:
            print("HEALTH FAIL:", exc.status_code, exc)
        finally:
            await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
