import asyncio,json,logging
from uuid import UUID
from app.core.redis import redis_client
from app.realtime.manager import manager
CHANNEL="watesly:realtime"; log=logging.getLogger(__name__)
async def publish_event(account_id:UUID,event:dict)->None:
 await redis_client.publish(CHANNEL,json.dumps({"account_id":str(account_id),"event":event}))
async def listen_for_events()->None:
 backoff=1
 while True:
  pubsub=None
  try:
   pubsub=redis_client.pubsub(); await pubsub.subscribe(CHANNEL); backoff=1
   async for message in pubsub.listen():
    if message.get("type")!="message":continue
    try:
     payload=json.loads(message["data"]); event=payload["event"]; event_id=(event.get("event") or {}).get("event_id") or event.get("event_id")
     if event_id:
      fresh=await redis_client.set(f"realtime:processed:{event_id}","1",ex=86400,nx=True)
      if not fresh:continue
     await manager.broadcast(UUID(payload["account_id"]),event)
    except asyncio.CancelledError:raise
    except Exception:log.exception("Realtime message processing failed")
  except asyncio.CancelledError:raise
  except Exception:log.exception("Realtime listener disconnected; reconnecting"); await asyncio.sleep(backoff); backoff=min(backoff*2,30)
  finally:
   if pubsub:
    try: await pubsub.close()
    except Exception: pass
