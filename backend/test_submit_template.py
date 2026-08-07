"""Test template submit to Meta on production."""
import asyncio

from sqlalchemy import select

from app.db.session import AsyncSessionFactory
from app.models.whatsapp_template import WhatsAppTemplate, TemplateStatus
from app.services.meta_template_submit import submit_template_to_meta


async def main() -> None:
    async with AsyncSessionFactory() as db:
        template = (
            await db.execute(
                select(WhatsAppTemplate)
                .where(WhatsAppTemplate.status.in_([TemplateStatus.DRAFT, TemplateStatus.REJECTED]))
                .order_by(WhatsAppTemplate.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if template is None:
            template = (
                await db.execute(select(WhatsAppTemplate).order_by(WhatsAppTemplate.created_at.desc()).limit(1))
            ).scalar_one()
        print("TEMPLATE", template.id, template.name, template.status)
        result = await submit_template_to_meta(
            db,
            account_id=template.account_id,
            template_id=template.id,
        )
        print("RESULT", result.name, result.status, result.meta_template_id)


if __name__ == "__main__":
    asyncio.run(main())
