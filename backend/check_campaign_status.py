"""One-off production diagnostic for campaign failures."""
import asyncio
from sqlalchemy import select

from app.db.session import AsyncSessionFactory
from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import WhatsAppTemplate


async def main() -> None:
    async with AsyncSessionFactory() as db:
        for wa in (await db.execute(select(WhatsAppAccount))).scalars():
            print(
                "WA",
                wa.id,
                wa.display_name,
                wa.status,
                wa.phone_number_id,
                wa.waba_id,
                wa.display_phone_number,
            )
        rows = (
            await db.execute(
                select(Campaign, WhatsAppTemplate)
                .outerjoin(WhatsAppTemplate, WhatsAppTemplate.id == Campaign.template_id)
                .order_by(Campaign.created_at.desc())
                .limit(3)
            )
        ).all()
        for camp, tmpl in rows:
            print(
                "CAMP",
                camp.id,
                camp.name,
                camp.status,
                tmpl.name if tmpl else None,
                tmpl.status if tmpl else None,
                tmpl.meta_status if tmpl else None,
            )
        rec_rows = (
            await db.execute(
                select(CampaignRecipient, Contact)
                .join(Contact, Contact.id == CampaignRecipient.contact_id)
                .order_by(CampaignRecipient.last_attempt_at.desc().nullslast())
                .limit(5)
            )
        ).all()
        for rec, contact in rec_rows:
            print("REC", rec.status, rec.error_message, contact.external_address)


if __name__ == "__main__":
    asyncio.run(main())
