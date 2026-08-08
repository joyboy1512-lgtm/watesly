from fastapi import APIRouter

from app.api.routes.site_content import public_router as public_site_router
from app.api.routes.site_content import router as site_content_router
from app.api.routes.admin import router as admin_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.auth import router as auth_router
from app.api.routes.automations import router as automations_router
from app.api.routes.billing import router as billing_router
from app.api.routes.channels import router as channels_router
from app.api.routes.catalog import router as catalog_router
from app.api.routes.campaigns import router as campaigns_router
from app.api.routes.contacts import router as contacts_router
from app.api.routes.core_engine import router as core_engine_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.external import router as external_router
from app.api.routes.health import router as health_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.knowledge import router as knowledge_router
from app.api.routes.tracking import router as tracking_router
from app.api.routes.inbox_tools import router as inbox_tools_router
from app.api.routes.operations import router as operations_router
from app.api.routes.organizations import router as organizations_router
from app.api.routes.platform import router as platform_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.realtime import router as realtime_router
from app.api.routes.reports import router as reports_router
from app.api.routes.team import router as team_router
from app.api.routes.trust import router as trust_router
from app.api.routes.templates import router as templates_router
from app.api.routes.uploads import router as uploads_router
from app.api.routes.whatsapp import router as whatsapp_router
from app.api.routes.growth_webhooks import router as growth_webhooks_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(auth_router, prefix="/auth", tags=["authentication"])
api_router.include_router(automations_router, prefix="/automations", tags=["automations"])
api_router.include_router(team_router, prefix="/team", tags=["team"])
api_router.include_router(trust_router, prefix="/trust", tags=["trust-center"])
api_router.include_router(organizations_router, prefix="/organizations", tags=["organizations"])
api_router.include_router(operations_router, prefix="/operations", tags=["operations"])
api_router.include_router(platform_router, prefix="/platform", tags=["platform"])
api_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
api_router.include_router(billing_router, prefix="/billing", tags=["billing"])
api_router.include_router(channels_router, prefix="/channels", tags=["channels"])
api_router.include_router(templates_router, prefix="/templates", tags=["templates"])
api_router.include_router(campaigns_router, prefix="/campaigns", tags=["campaigns"])
api_router.include_router(contacts_router, prefix="/contacts", tags=["contacts"])
api_router.include_router(catalog_router, prefix="/catalog", tags=["catalog"])
api_router.include_router(core_engine_router, prefix="/core", tags=["core-engine"])
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(external_router, prefix="/external", tags=["external-api"])
api_router.include_router(conversations_router, prefix="/conversations", tags=["conversations"])
api_router.include_router(inbox_tools_router, prefix="/inbox-tools", tags=["inbox-tools"])
api_router.include_router(whatsapp_router, prefix="/whatsapp", tags=["whatsapp"])
api_router.include_router(realtime_router, prefix="/realtime", tags=["realtime"])
api_router.include_router(reports_router, prefix="/reports", tags=["reports"])
api_router.include_router(knowledge_router, prefix="/knowledge", tags=["knowledge"])
api_router.include_router(tracking_router, tags=["tracking"])
api_router.include_router(uploads_router, prefix="/uploads", tags=["uploads"])
api_router.include_router(assignments_router, prefix="/assignments", tags=["assignments"])
api_router.include_router(admin_router, prefix="/admin", tags=["super-admin"])
api_router.include_router(site_content_router, prefix="/admin", tags=["site-content"])
api_router.include_router(public_site_router, prefix="/public", tags=["public"])
api_router.include_router(growth_webhooks_router, prefix="/growth/ecommerce", tags=["growth-ecommerce"])
