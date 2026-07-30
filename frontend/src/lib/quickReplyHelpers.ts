import { api } from "./api";

export type QuickReply = {
  id: string;
  organization_id: string;
  channel_id: string | null;
  shortcut: string;
  title: string;
  body: string;
  category: string | null;
  tags: string | null;
  tone_variant: string | null;
  is_shared: boolean;
  is_active: boolean;
  sort_order: number;
  usage_count: number;
};

export type QuickReplyAnalytics = {
  summary: { total: number; unused: number; total_usage: number };
  top_used: QuickReply[];
  unused: QuickReply[];
  by_category: Array<{ category: string; count: number }>;
};

export type Organization = { id: string; name: string };
export type Channel = { id: string; name: string };

export const QUICK_REPLY_CATEGORIES: Record<string, string> = {
  shipping: "الشحن",
  pricing: "الأسعار",
  welcome: "الترحيب",
  closing: "الإغلاق",
  support: "الدعم",
  payment: "الدفع",
  returns: "المرتجعات",
  general: "عام"
};

export const TONE_LABELS: Record<string, string> = {
  friendly: "ودود",
  formal: "رسمي",
  concise: "مختصر"
};

export const REPLY_VARIABLES = [
  { token: "{{contact.name}}", label: "اسم العميل" },
  { token: "{{contact.phone}}", label: "رقم الهاتف" },
  { token: "{{contact.email}}", label: "البريد" }
];

export type QuickReplyForm = {
  organizationId: string;
  channelId: string;
  shortcut: string;
  title: string;
  body: string;
  category: string;
  tags: string;
  toneVariant: string;
  isShared: boolean;
  sortOrder: string;
};

export const emptyQuickReplyForm = (): QuickReplyForm => ({
  organizationId: "",
  channelId: "",
  shortcut: "/",
  title: "",
  body: "مرحباً {{contact.name}}!",
  category: "general",
  tags: "",
  toneVariant: "",
  isShared: true,
  sortOrder: "0"
});

export function formFromQuickReply(item: QuickReply): QuickReplyForm {
  return {
    organizationId: item.organization_id,
    channelId: item.channel_id ?? "",
    shortcut: item.shortcut,
    title: item.title,
    body: item.body,
    category: item.category ?? "general",
    tags: item.tags ?? "",
    toneVariant: item.tone_variant ?? "",
    isShared: item.is_shared,
    sortOrder: String(item.sort_order ?? 0)
  };
}

export function buildQuickReplyPayload(form: QuickReplyForm) {
  return {
    organization_id: form.organizationId,
    channel_id: form.channelId || null,
    shortcut: form.shortcut.trim(),
    title: form.title.trim(),
    body: form.body.trim(),
    category: form.category || null,
    tags: form.tags.trim() || null,
    tone_variant: form.toneVariant || null,
    is_shared: form.isShared,
    sort_order: Number(form.sortOrder) || 0
  };
}

export function categoryLabel(category: string | null | undefined) {
  if (!category) return "—";
  return QUICK_REPLY_CATEGORIES[category] ?? category;
}

export async function downloadQuickRepliesExport() {
  const response = await api.get("/inbox-tools/quick-replies/export", { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = "quick-replies-export.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadQuickRepliesReport(format: "xlsx" | "csv") {
  const response = await api.get(`/reports/quick-replies/export?format=${format}`, {
    responseType: "arraybuffer"
  });
  const mime =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv;charset=utf-8";
  const blob = new Blob([response.data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quick-replies-report.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export function matchShortcutAutocomplete(
  text: string,
  replies: QuickReply[]
): QuickReply | null {
  const match = text.match(/(?:^|\s)(\/[\w\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF_-]*)$/u);
  if (!match) return null;
  const typed = match[1].toLowerCase();
  const exact = replies.find((item) => item.shortcut.toLowerCase() === typed);
  if (exact) return exact;
  const candidates = replies.filter((item) => item.shortcut.toLowerCase().startsWith(typed));
  return candidates.length === 1 ? candidates[0] : null;
}
