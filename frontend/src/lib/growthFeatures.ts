/** Arabic labels for growth feature flags (mirrors backend FLAG_LABELS_AR). */
export const GROWTH_FLAG_LABELS: Record<string, string> = {
  ai_agent_auto_reply: "رد تلقائي خارج ساعات العمل",
  sla_monitoring: "مراقبة SLA",
  privacy_mask_agents: "إخفاء الهاتف/البريد عن الموظفين",
  instagram_channel: "قناة Instagram (تجريبي)",
  messenger_channel: "قناة Messenger (تجريبي)",
  marketplace_installs: "Marketplace — قوالب التكامل",
  http_automation_requests: "طلبات HTTP في الأتمتة",
  carousel_templates: "المرحلة A — قوالب Carousel",
  fast_campaigns: "المرحلة A — إرسال حملات أسرع",
  ctwa_dashboard: "المرحلة A — لوحة CTWA",
  meta_capi: "المرحلة A — Meta Conversions API",
  follow_up_campaigns: "المرحلة A — حملات متابعة",
  no_code_bot_enhanced: "المرحلة B — بوت no-code محسّن",
  collect_input_forms: "المرحلة B — جمع بيانات (Forms)",
  ai_lead_agent: "المرحلة B — AI Lead Agent",
  ai_support_agent: "المرحلة B — AI Support Agent",
  shopify_integration: "المرحلة C — Shopify",
  woocommerce_integration: "المرحلة C — WooCommerce",
  order_templates: "المرحلة C — قوالب رسائل الطلبات"
};

export type CtwaDashboard = {
  period_days: number;
  ctwa_leads: number;
  tracked_link_clicks: number;
  deals_from_ctwa: number;
  sources: { source: string; count: number }[];
  campaigns: { name: string; count: number }[];
  tracked_links: {
    name: string;
    slug: string;
    clicks: number;
    campaign_id: string | null;
  }[];
  attributed_campaigns: { name: string; contacts: number }[];
};

export type PreflightCheck = {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
};
