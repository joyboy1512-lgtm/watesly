"""Default platform site content (seed for CMS)."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

DEFAULT_BRANDING: dict[str, Any] = {
    "app_name": "Watesly",
    "logo_dark_url": "/brand/watesly-logo-dark.png",
    "logo_light_url": "/brand/watesly-logo-light.png",
    "icon_url": "/brand/watesly-icon.png",
    "hero_image_url": "",
    "primary_color": "#075e54",
    "accent_color": "#25d366",
}

DEFAULT_DISPLAY: dict[str, bool] = {
    "show_hero_mockup": True,
    "show_features": True,
    "show_how": True,
    "show_api": True,
    "show_cta": True,
    "show_stats": True,
}

LOCALE_DEFAULTS: dict[str, dict[str, Any]] = {
    "ar": {
        "landing": {
            "features": "الميزات",
            "howItWorks": "كيف يعمل",
            "api": "API",
            "signIn": "تسجيل الدخول",
            "getStarted": "ابدأ الآن",
            "heroEyebrow": "منصة WhatsApp للمبيعات والدعم",
            "heroTitle": "بيع، خدمة، وتابع عملاءك",
            "heroTitleAccent": " على WhatsApp — في منصة واحدة.",
            "heroLead": "Watesly يجمع صندوق الوارد، الحملات، CRM، الكتalog الذكي، التحليلات، وAPI للمطورين — حتى تحوّل كل محادثة إلى فرصة بيع حقيقية.",
            "tryPlatform": "جرّب المنصة",
            "exploreFeatures": "استكشف الميزات",
            "featuresEyebrow": "كل ما تحتاجه",
            "featuresTitle": "منصة متكاملة — ليس مجرد inbox",
            "featuresSubtitle": "من أول رسالة واردة حتى إغلاق الصفقة والتقرير التنفيذي.",
            "howEyebrow": "بسيط وسريع",
            "howTitle": "كيف يعمل Watesly؟",
            "apiEyebrow": "منصة المطورين",
            "apiTitle": "API & Webhooks للتوسع",
            "apiBody": "REST API خارجي، مفاتيح scoped، webhooks موقّعة HMAC، rate limits، وتكاملات Marketplace — لربط Watesly مع ERP، متجرك، أو Zapier.",
            "apiDemo": "اطلب demo للفريق التقني",
            "ctaTitle": "جاهز لتحويل WhatsApp إلى قناة مبيعات؟",
            "ctaBody": "ابدأ اليوم — اربط رقمك، أضف منتجاتك، واستقبل أول محادثة.",
            "enterPlatform": "دخول المنصة",
            "footerTagline": "منصة WhatsApp Business للمبيعات، الدعم، والتكامل.",
            "footerRights": "© {{year}} Watesly. جميع الحقوق محفوظة.",
        },
        "login": {
            "heroTitle": "بيع وخدمة عملائك على WhatsApp — بأسعارك الحقيقية.",
            "heroBody": "أضف منتجاتك وخدماتك، والذكاء الاصطناعي يرد على استفسارات العملاء بالأسعار والمواصفات فوراً.",
            "trustCatalog": "✓ دليل منتجات وخدمات",
            "trustAi": "✓ ردود AI من أسعارك",
            "trustInbox": "✓ صندوق واتساب موحّد",
        },
        "stats": [
            {"value": "WhatsApp-first", "label": "مصمم للسوق العربي"},
            {"value": "AI + CRM", "label": "ذكاء + مبيعات"},
            {"value": "API", "label": "تكامل مع أنظمتك"},
            {"value": "GDPR", "label": "امتثال وثقة"},
        ],
        "features": [
            {"icon": "💬", "title": "صندوق وارد WhatsApp", "desc": "محادثات موحّدة، SLA، ردود سريعة، AI، وإرسال منتجات من الكتalog مباشرة."},
            {"icon": "👥", "title": "العملاء والحملات", "desc": "إدارة جهات الاتصال، segments، حملات WhatsApp جماعية، وتقارير تسليم وقراءة."},
            {"icon": "📈", "title": "CRM وصفقات", "desc": "Kanban للمبيعات، إنشاء صفقات من المحادثة، pipeline، وتقارير إيراد."},
            {"icon": "🛒", "title": "الكتalog الذكي", "desc": "منتجات وخدمات بأسعارك — AI يرد على استفسارات الأسعار تلقائياً."},
            {"icon": "📊", "title": "تحليلات وتقارير", "desc": "لوحة حية، CSAT، أداء الفريق، ROI حملات، وتصدير Excel."},
            {"icon": "⚡", "title": "API للمطورين", "desc": "REST API، webhooks موقّعة، rate limits — للربط مع Zapier وHubSpot."},
        ],
        "steps": [
            {"title": "اربط WhatsApp", "desc": "اتصل برقم Business API خلال دقائق."},
            {"title": "أضف منتجاتك", "desc": "كتalog، ردود سريعة، وقاعدة معرفة."},
            {"title": "بيع وتابع", "desc": "ردود، حملات، CRM، وتحليلات في مكان واحد."},
        ],
        "mockup": {
            "title": "Watesly Inbox",
            "pill": "3 محادثات بانتظار الرد",
            "messages": [
                {"role": "incoming", "text": "السلام عليكم، كم سعر الباقة؟"},
                {"role": "outgoing", "text": "أهلاً! الباقة 25 د.ك — تشمل 500 رسالة."},
                {"role": "incoming", "text": "ممتاز، أريد الطلب"},
            ],
            "deal_card": {
                "label": "صفقة CRM",
                "title": "باقة WhatsApp — 25 KWD",
                "note": "تم إنشاؤها من المحادثة",
            },
        },
        "api": {
            "checklist": [
                "GET/POST contacts & CRM deals",
                "إرسال رسائل عبر API",
                "Webhooks: message.received, deal.won",
                "OpenAPI + Swagger",
            ],
            "code_sample": 'curl -H "Authorization: Bearer mw_..." \\\n  https://api.watesly.com/v1/external/contacts\n\n# Webhook signature\nX-Watesly-Signature: sha256=...',
        },
    },
    "en": {
        "landing": {
            "features": "Features",
            "howItWorks": "How it works",
            "api": "API",
            "signIn": "Sign In",
            "getStarted": "Get Started",
            "heroEyebrow": "WhatsApp platform for sales and support",
            "heroTitle": "Sell, support, and follow up",
            "heroTitleAccent": " on WhatsApp — in one platform.",
            "heroLead": "Watesly brings inbox, campaigns, CRM, smart catalog, analytics, and developer API together — so every conversation becomes a real sales opportunity.",
            "tryPlatform": "Try the platform",
            "exploreFeatures": "Explore features",
            "featuresEyebrow": "Everything you need",
            "featuresTitle": "All-in-one platform — not just an inbox",
            "featuresSubtitle": "From the first inbound message to closing the deal and executive reporting.",
            "howEyebrow": "Simple and fast",
            "howTitle": "How does Watesly work?",
            "apiEyebrow": "Developer Platform",
            "apiTitle": "API & Webhooks for scale",
            "apiBody": "External REST API, scoped keys, HMAC-signed webhooks, rate limits, and marketplace integrations — connect Watesly to ERP, your store, or Zapier.",
            "apiDemo": "Request a technical demo",
            "ctaTitle": "Ready to turn WhatsApp into a sales channel?",
            "ctaBody": "Start today — connect your number, add products, and receive your first conversation.",
            "enterPlatform": "Enter platform",
            "footerTagline": "WhatsApp Business platform for sales, support, and integrations.",
            "footerRights": "© {{year}} Watesly. All rights reserved.",
        },
        "login": {
            "heroTitle": "Sell and support customers on WhatsApp — with your real prices.",
            "heroBody": "Add your products and services, and AI replies to customer questions with prices and specs instantly.",
            "trustCatalog": "✓ Product & service catalog",
            "trustAi": "✓ AI replies from your prices",
            "trustInbox": "✓ Unified WhatsApp inbox",
        },
        "stats": [
            {"value": "WhatsApp-first", "label": "Built for Arabic markets"},
            {"value": "AI + CRM", "label": "Intelligence + sales"},
            {"value": "API", "label": "Integrate with your stack"},
            {"value": "GDPR", "label": "Compliance & trust"},
        ],
        "features": [
            {"icon": "💬", "title": "WhatsApp Inbox", "desc": "Unified conversations, SLA, quick replies, AI, and product sends from your catalog."},
            {"icon": "👥", "title": "Contacts & Campaigns", "desc": "Manage contacts, segments, bulk WhatsApp campaigns, and delivery/read reports."},
            {"icon": "📈", "title": "CRM & Deals", "desc": "Sales Kanban, deals from conversations, pipeline, and revenue reports."},
            {"icon": "🛒", "title": "Smart Catalog", "desc": "Products and services at your prices — AI answers pricing questions automatically."},
            {"icon": "📊", "title": "Analytics & Reports", "desc": "Live dashboard, CSAT, team performance, campaign ROI, and Excel export."},
            {"icon": "⚡", "title": "Developer API", "desc": "REST API, signed webhooks, rate limits — connect with Zapier and HubSpot."},
        ],
        "steps": [
            {"title": "Connect WhatsApp", "desc": "Link your Business API number in minutes."},
            {"title": "Add your products", "desc": "Catalog, quick replies, and knowledge base."},
            {"title": "Sell and follow up", "desc": "Replies, campaigns, CRM, and analytics in one place."},
        ],
        "mockup": {
            "title": "Watesly Inbox",
            "pill": "3 conversations waiting for reply",
            "messages": [
                {"role": "incoming", "text": "Hi, how much is the plan?"},
                {"role": "outgoing", "text": "Hello! The plan is 25 KWD — includes 500 messages."},
                {"role": "incoming", "text": "Great, I want to order"},
            ],
            "deal_card": {
                "label": "CRM Deal",
                "title": "WhatsApp Plan — 25 KWD",
                "note": "Created from conversation",
            },
        },
        "api": {
            "checklist": [
                "GET/POST contacts & CRM deals",
                "Send messages via API",
                "Webhooks: message.received, deal.won",
                "OpenAPI + Swagger",
            ],
            "code_sample": 'curl -H "Authorization: Bearer mw_..." \\\n  https://api.watesly.com/v1/external/contacts\n\n# Webhook signature\nX-Watesly-Signature: sha256=...',
        },
    },
}


def default_site_config() -> dict[str, Any]:
    return {
        "branding": deepcopy(DEFAULT_BRANDING),
        "display": deepcopy(DEFAULT_DISPLAY),
        "locales": deepcopy(LOCALE_DEFAULTS),
    }
