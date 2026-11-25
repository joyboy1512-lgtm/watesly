import { api } from "./api";

export type KnowledgeArticle = {
  id: string;
  title: string;
  body: string;
  category: string;
  keywords: string | null;
  channel_id?: string | null;
  is_active: boolean;
  sort_order: number;
  usage_count: number;
  helpful_count?: number;
  dismiss_count?: number;
  language: string;
};

export type BusinessHoursDay = [string, string] | null;

export type BusinessHoursConfig = {
  timezone: string;
  days: Record<string, BusinessHoursDay>;
};

export type AgentSettings = {
  default_mode: "kb_first" | "catalog_first" | "combined" | "local";
  tone: "friendly" | "formal" | "concise";
  language: string;
  agent_enabled: boolean;
  llm_enabled: boolean;
  auto_kb_on_inbound: boolean;
  llm_system_prompt: string | null;
  llm_available: boolean;
  llm_key_configured?: boolean;
  llm_key_source?: "account" | "env" | "none";
  llm_api_base_url?: string | null;
  llm_model?: string | null;
  auto_reply_outside_hours?: boolean;
  business_hours_json?: BusinessHoursConfig | Record<string, unknown>;
  outside_hours_message?: string | null;
  within_business_hours?: boolean;
};

export type AgentSettingsPatch = Partial<
  Omit<AgentSettings, "llm_available" | "llm_key_configured" | "llm_key_source" | "within_business_hours">
> & {
  llm_api_key?: string | null;
  clear_llm_api_key?: boolean;
};

export type SmartReplyResult = {
  suggestion: string;
  source?: string;
  confidence?: number;
  engine?: string;
  expanded_terms?: string[];
  needs_clarification?: boolean;
  matched_articles?: Array<{
    id: string;
    title: string;
    category: string;
    body?: string;
    score?: number;
    reasons?: string[];
  }>;
  matched_products?: Array<{
    id: string;
    name: string;
    price_label: string;
    score?: number;
    clarify_option?: number;
  }>;
};

export type QualityEvalResult = {
  total: number;
  hits: number;
  hit_rate: number;
  results: Array<{
    index: number;
    query: string;
    matched: boolean;
    top_article_id?: string | null;
    top_title?: string | null;
    top_score: number;
    reasons: string[];
    candidates: Array<{ id: string; title: string; score: number; category: string }>;
  }>;
};

export async function sendArticleFeedback(articleId: string, helpful: boolean) {
  return api.post(`/knowledge/${articleId}/feedback`, { helpful });
}

export async function evaluateKnowledgeQuality(cases: Array<{ query: string; expected_title?: string }>) {
  return api.post<QualityEvalResult>("/knowledge/evaluate", { cases });
}

export type CopilotResult = {
  summary?: string;
  intent?: { intent: string; confidence: number };
  emotion?: { emotion: string; confidence: number };
  suggestions?: Array<{ mode: string; text: string; source?: string }>;
  llm_available?: boolean;
};

export const CATEGORY_LABELS: Record<string, string> = {
  general: "عام",
  faq: "أسئلة شائعة",
  shipping: "شحن وتوصيل",
  returns: "إرجاع واسترداد",
  pricing: "أسعار وعروض"
};

export const MODE_LABELS: Record<string, string> = {
  kb_first: "قاعدة المعرفة أولاً",
  catalog_first: "الكتالوج أولاً",
  combined: "مدمج (KB + منتجات)",
  local: "AI محلي"
};

export const SOURCE_LABELS: Record<string, string> = {
  knowledge_base: "قاعدة المعرفة",
  catalog: "الكتالوج",
  catalog_clarify: "توضيح أنواع المنتج",
  combined: "مدمج",
  local: "AI محلي",
  "knowledge_base+llm": "KB + LLM",
  "catalog+llm": "كتالوج + LLM",
  "combined+llm": "مدمج + LLM"
};

export const DAY_LABELS: Record<string, string> = {
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
  sat: "السبت"
};

export const DAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  timezone: "Asia/Kuwait",
  days: {
    mon: ["09:00", "18:00"],
    tue: ["09:00", "18:00"],
    wed: ["09:00", "18:00"],
    thu: ["09:00", "18:00"],
    fri: ["09:00", "18:00"],
    sat: null,
    sun: null
  }
};

export function normalizeBusinessHours(raw?: Record<string, unknown> | BusinessHoursConfig | null): BusinessHoursConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<BusinessHoursConfig>;
  const daysIn = (source.days && typeof source.days === "object" ? source.days : DEFAULT_BUSINESS_HOURS.days) as Record<
    string,
    BusinessHoursDay
  >;
  const days: Record<string, BusinessHoursDay> = {};
  for (const key of DAY_ORDER) {
    const slot = daysIn[key];
    if (Array.isArray(slot) && slot.length >= 2) {
      days[key] = [String(slot[0]), String(slot[1])];
    } else {
      days[key] = null;
    }
  }
  return {
    timezone: String(source.timezone || DEFAULT_BUSINESS_HOURS.timezone),
    days
  };
}

export function llmStatusLabel(settings: AgentSettings): string {
  if (!settings.llm_available) return "غير متاح — أضف مفتاح API";
  if (!settings.llm_enabled) return "متاح — غير مفعّل";
  if (settings.llm_key_source === "account") return "مفعّل (مفتاح الحساب)";
  if (settings.llm_key_source === "env") return "مفعّل (مفتاح السيرفر)";
  return "مفعّل";
}

export async function downloadKnowledgeExport() {
  const response = await api.get("/knowledge/export", { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([response.data], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "knowledge-export.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
