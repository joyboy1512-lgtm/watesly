import asyncio
import random
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update

from app.core.encryption import decrypt_secret
from app.db.session import AsyncSessionFactory
from app.models.campaign import Campaign, CampaignStatus
from app.models.campaign_recipient import CampaignRecipient, CampaignRecipientStatus
from app.models.contact import Contact
from app.models.whatsapp_account import WhatsAppAccount
from app.models.whatsapp_template import WhatsAppTemplate
from app.services.feature_flags import get_feature_flags
from app.services.meta_client import MetaAPIError, MetaWhatsAppClient
from app.services.phone_normalize import normalize_whatsapp_phone
from app.services.template_media import resolve_send_components
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

STALE_SENDING_MINUTES = 10
COUNTRY_DIAL = {"KW": "965", "SA": "966", "AE": "971", "QA": "974", "BH": "973", "OM": "968"}
async def _run_campaign(campaign_id:UUID,execution_token:UUID)->dict:
 async with AsyncSessionFactory() as db:
  campaign=(await db.execute(select(Campaign).where(Campaign.id==campaign_id).with_for_update())).scalar_one_or_none()
  if campaign is None:return {"status":"not_found"}
  if campaign.execution_token!=execution_token:return {"status":"stale_task"}
  if campaign.requires_approval and not campaign.approved_at:return {"status":"blocked","reason":"approval_required"}
  if campaign.status==CampaignStatus.CANCELLED:return {"status":"cancelled"}
  wa=await db.get(WhatsAppAccount,campaign.whatsapp_account_id); template=await db.get(WhatsAppTemplate,campaign.template_id)
  if not wa or not template: campaign.status=CampaignStatus.FAILED; await db.commit(); return {"status":"failed","reason":"missing_configuration"}
  flags = await get_feature_flags(db, account_id=campaign.account_id)
  fast_mode = bool(flags.get("fast_campaigns"))
  batch_size = 50 if fast_mode else 25
  sleep_min = 0.08 if fast_mode else 0.25
  sleep_jitter = 0.12 if fast_mode else 0.35
  campaign.status=CampaignStatus.RUNNING; campaign.started_at=campaign.started_at or datetime.now(UTC); campaign.last_heartbeat_at=datetime.now(UTC); await db.commit()
  client=MetaWhatsAppClient(access_token=decrypt_secret(wa.access_token_encrypted),phone_number_id=wa.phone_number_id); sent=failed=0
  while True:
   await db.refresh(campaign)
   if campaign.execution_token!=execution_token:return {"status":"superseded"}
   if campaign.status in {CampaignStatus.PAUSED,CampaignStatus.CANCELLED}:return {"status":campaign.status.value,"sent":sent,"failed":failed}
   cutoff=datetime.now(UTC)-timedelta(minutes=STALE_SENDING_MINUTES)
   await db.execute(update(CampaignRecipient).where(CampaignRecipient.campaign_id==campaign.id,CampaignRecipient.status==CampaignRecipientStatus.SENDING,CampaignRecipient.sending_started_at<cutoff,CampaignRecipient.external_message_id.is_(None)).values(status=CampaignRecipientStatus.FAILED,error_message="Delivery state unknown after worker interruption; reconcile before retry",sending_started_at=None))
   rows=(await db.execute(select(CampaignRecipient,Contact).join(Contact,Contact.id==CampaignRecipient.contact_id).where(CampaignRecipient.campaign_id==campaign.id,CampaignRecipient.status.in_([CampaignRecipientStatus.PENDING,CampaignRecipientStatus.QUEUED]),Contact.deleted_at.is_(None)).with_for_update(skip_locked=True).limit(batch_size))).all()
   if not rows:break
   for recipient,contact in rows:
    await db.refresh(campaign)
    if campaign.execution_token!=execution_token or campaign.status in {CampaignStatus.PAUSED,CampaignStatus.CANCELLED}: await db.commit(); return {"status":campaign.status.value,"sent":sent,"failed":failed}
    now=datetime.now(UTC)
    if contact.marketing_opt_in is False:
     recipient.status=CampaignRecipientStatus.SKIPPED
     recipient.error_message="Marketing opt-out"
     recipient.last_attempt_at=now
     campaign.last_heartbeat_at=now
     await db.commit()
     await asyncio.sleep(sleep_min+random.random()*sleep_jitter)
     continue
    recipient.status=CampaignRecipientStatus.SENDING; recipient.sending_started_at=now; recipient.last_attempt_at=now; recipient.delivery_key=recipient.delivery_key or f"campaign:{campaign.id}:recipient:{recipient.id}"; campaign.last_heartbeat_at=now; await db.commit()
    try:
     components=resolve_send_components(template.components, recipient.template_parameters)
     dial=COUNTRY_DIAL.get((contact.country_code or "KW").upper(), "965")
     to=normalize_whatsapp_phone(contact.external_address, country_code=dial)
     if not to:
      recipient.status=CampaignRecipientStatus.FAILED
      recipient.error_message="Invalid phone number"
      failed+=1
     else:
      response=await client.send_template(to=to,template_name=template.name,language_code=template.language,components=components)
      messages=response.get("messages",[]); recipient.external_message_id=messages[0].get("id") if messages else None; recipient.status=CampaignRecipientStatus.SENT; recipient.error_message=None; sent+=1
      if recipient.external_message_id:
       from app.services.campaigns import record_campaign_outbound_message
       from app.realtime.event_bus import publish_event
       message=await record_campaign_outbound_message(db,campaign=campaign,recipient=recipient,contact=contact,wa=wa,template=template,to_address=to,external_message_id=recipient.external_message_id,send_components=components)
       if message is not None:
        await publish_event(campaign.account_id,{"type":"whatsapp.updated","conversation_id":str(message.conversation_id)})
    except MetaAPIError as exc: recipient.status=CampaignRecipientStatus.FAILED; recipient.error_message=str(exc)[:2000]; failed+=1
    finally: recipient.sending_started_at=None
    await db.commit(); await asyncio.sleep(sleep_min+random.random()*sleep_jitter)
  campaign.status=CampaignStatus.COMPLETED if failed==0 else CampaignStatus.COMPLETED_WITH_ERRORS; campaign.completed_at=datetime.now(UTC); campaign.active_task_id=None; await db.commit(); return {"status":campaign.status.value,"sent":sent,"failed":failed}

@celery_app.task(name="watesly.campaigns.run", max_retries=0)
def run_campaign(campaign_id: str, execution_token: str) -> dict:
    return run_async(_run_campaign(UUID(campaign_id), UUID(execution_token)))
