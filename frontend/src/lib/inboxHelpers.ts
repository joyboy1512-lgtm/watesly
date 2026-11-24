import { api } from "./api";

/** Max conversations the inbox may request (matches backend le=5000). */
export const INBOX_CONVERSATIONS_LIMIT = 5000;
/** First page / each "load more" chunk — keeps initial inbox load light. */
export const INBOX_CONVERSATIONS_PAGE_SIZE = 100;

const DEFAULT_COUNTRY_CODE = "965";

export function normalizeWhatsAppPhone(value: string, countryCode = DEFAULT_COUNTRY_CODE): string {
  let digits = (value || "").replace(/\D/g, "");
  if (!digits) return "";
  const cc = (countryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, "") || DEFAULT_COUNTRY_CODE;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && cc === "965") {
    digits = `${cc}${digits.slice(1)}`;
  } else if (!digits.startsWith(cc) && digits.length <= 11) {
    const local = digits.replace(/^0+/, "");
    if (local) digits = `${cc}${local}`;
  }
  return digits;
}

export function phonesMatch(left: string, right: string, countryCode = DEFAULT_COUNTRY_CODE): boolean {
  const leftNorm = normalizeWhatsAppPhone(left, countryCode);
  const rightNorm = normalizeWhatsAppPhone(right, countryCode);
  return Boolean(leftNorm && rightNorm && leftNorm === rightNorm);
}

/** Human waiting duration: minutes → hours → days for long waits. */
export function formatWaitingMinutes(minutes: number | null | undefined) {
  if (minutes == null) return "";
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return `${total} د`;
  if (total < 1440) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours} س ${rest} د` : `${hours} س`;
  }
  const days = Math.floor(total / 1440);
  const remHours = Math.floor((total % 1440) / 60);
  return remHours ? `${days} ي ${remHours} س` : `${days} ي`;
}

/** Exact timestamp for waiting tooltip (last inbound / last message). */
export function formatWaitingExactTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/** Oldest waiting = highest waiting_minutes (longest since last inbound needing reply). */
export function pickOldestWaitingConversation<T extends { waiting_minutes?: number | null; last_inbound_at?: string | null; last_message_at?: string | null }>(
  items: T[]
): T | null {
  if (!items.length) return null;
  return [...items].sort((a, b) => {
    const waitDiff = (b.waiting_minutes ?? 0) - (a.waiting_minutes ?? 0);
    if (waitDiff !== 0) return waitDiff;
    const aAt = a.last_inbound_at || a.last_message_at || "";
    const bAt = b.last_inbound_at || b.last_message_at || "";
    return aAt.localeCompare(bAt);
  })[0] ?? null;
}

export function sortWaitingOldestFirst<T extends { waiting_minutes?: number | null; last_inbound_at?: string | null; last_message_at?: string | null }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const waitDiff = (b.waiting_minutes ?? 0) - (a.waiting_minutes ?? 0);
    if (waitDiff !== 0) return waitDiff;
    const aAt = a.last_inbound_at || a.last_message_at || "";
    const bAt = b.last_inbound_at || b.last_message_at || "";
    return aAt.localeCompare(bAt);
  });
}

const messageStatusLabels: Record<string, string> = {
  received: "✓",
  queued: "◷",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "⚠"
};

export function formatMessageStatus(status: string, direction: string): { label: string; className: string } | null {
  if (direction === "inbound") return null;
  const normalized = status.toLowerCase();
  const label = messageStatusLabels[normalized] ?? status;
  if (normalized === "read") return { label, className: "read" };
  if (normalized === "failed") return { label, className: "failed" };
  if (normalized === "delivered") return { label, className: "delivered" };
  return { label, className: "sent" };
}

export function snoozeUntilTomorrowMorning(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

export function isCurrentlySnoozed(snoozedUntil: string | null | undefined): boolean {
  if (!snoozedUntil) return false;
  const until = new Date(snoozedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
}

export function formatSnoozedUntil(snoozedUntil: string | null | undefined): string {
  if (!snoozedUntil) return "";
  const until = new Date(snoozedUntil);
  if (Number.isNaN(until.getTime())) return "";
  return new Intl.DateTimeFormat("ar", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short"
  }).format(until);
}

export async function startConversationOnChannel(payload: {
  channel_id: string;
  external_address: string;
  display_name?: string | null;
}): Promise<{ conversation_id: string; channel_id: string; contact_id: string; created: boolean }> {
  const response = await api.post<{
    conversation_id: string;
    channel_id: string;
    contact_id: string;
    created: boolean;
  }>("/conversations/start", payload, { skipGlobalErrorToast: true });
  return response.data;
}
