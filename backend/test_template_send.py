"""Test template send and print full Meta error."""
import asyncio
import json

from sqlalchemy import select

from app.core.encryption import decrypt_secret
from app.db.session import AsyncSessionFactory
from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import WhatsAppTemplate
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.template_media import resolve_send_components


async def main() -> None:
    async with AsyncSessionFactory() as db:
        camp = (
            await db.execute(select(Campaign).order_by(Campaign.created_at.desc()).limit(1))
        ).scalar_one()
        wa = await db.get(WhatsAppAccount, camp.whatsapp_account_id)
        tmpl = await db.get(WhatsAppTemplate, camp.template_id)
        rec, contact = (
            await db.execute(
                select(CampaignRecipient, Contact)
                .join(Contact)
                .where(CampaignRecipient.campaign_id == camp.id)
                .limit(1)
            )
        ).one()
        print("template:", tmpl.name, tmpl.language, tmpl.status)
        print("to:", contact.external_address)
        print("params:", rec.template_parameters)
        print("components stored:", json.dumps(tmpl.components, ensure_ascii=False)[:500])
        components = resolve_send_components(tmpl.components, rec.template_parameters)
        print("send components:", json.dumps(components, ensure_ascii=False))
        client = MetaWhatsAppClient(
            access_token=decrypt_secret(wa.access_token_encrypted),
            phone_number_id=wa.phone_number_id,
        )
        try:
            resp = await client.send_template(
                to=contact.external_address,
                template_name=tmpl.name,
                language_code=tmpl.language,
                components=components,
            )
            print("SEND OK:", resp)
        except MetaAPIError as exc:
            print("SEND FAIL:", exc.status_code, exc)
            print("RESPONSE:", exc.response_data)
        finally:
            await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
