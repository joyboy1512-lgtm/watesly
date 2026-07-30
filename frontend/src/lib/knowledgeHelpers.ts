import { api } from "./api";

export type KnowledgeArticle = {
  id: string;
  title: string;
  body: string;
  category: string;
  keywords: string | null;
  is_active: boolean;
  sort_order: number;
  usage_count: number;
  language: string;
};

export type AgentSettings = {
  default_mode: "kb_first" | "catalog_first" | "combined" | "local";
  tone: "friendly" | "formal" | "concise";
  language: string;
  llm_enabled: boolean;
  auto_kb_on_inbound: boolean;
  llm_system_prompt: string | null;
  llm_available: boolean;
};

export type SmartReplyResult = {
  suggestion: string;
  source?: string;
  confidence?: number;
  matched_articles?: Array<{ id: string; title: string; category: string; body?: string }>;
  matched_products?: Array<{ id: string; name: string; price_label: string }>;
};

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
  catalog_first: "الكتalog أولاً",
  combined: "مدمج (KB + منتجات)",
  local: "AI محلي"
};

export const SOURCE_LABELS: Record<string, string> = {
  knowledge_base: "قاعدة المعرفة",
  catalog: "الكتalog",
  combined: "مدمج",
  local: "AI محلي",
  "knowledge_base+llm": "KB + LLM",
  "catalog+llm": "كتalog + LLM",
  "combined+llm": "مدمج + LLM"
};

export async function downloadKnowledgeExport() {
  const response = await api.get("/knowledge/export", { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([response.data], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "knowledge-export.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
