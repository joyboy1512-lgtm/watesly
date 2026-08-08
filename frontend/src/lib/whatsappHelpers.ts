import { QUALITY_LABELS, qualityClass } from "./metaEmbeddedSignup";
import { formatWhatsAppStatus, whatsappStatusBadgeClass } from "./teamHelpers";
import { formatAppTime } from "./language";

export type WhatsAppAccountRow = {
  id: string;
  channel_id: string;
  organization_id: string;
  channel_name?: string | null;
  organization_name?: string | null;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string;
  verified_name: string | null;
  status: string;
  connection_method?: string;
  quality_rating?: string | null;
  messaging_limit_tier?: string | null;
  messaging_limit?: number | null;
  health_synced_at?: string | null;
  meta_catalog_id?: string | null;
  commerce_enabled?: boolean;
  catalog_synced_at?: string | null;
};

export const CONNECTION_METHOD_LABELS: Record<string, string> = {
  embedded: "Embedded Signup",
  manual: "ربط يدوي"
};

export function formatConnectionMethod(method: string | undefined): string {
  if (!method) return "—";
  return CONNECTION_METHOD_LABELS[method] ?? method;
}

export function connectionMethodClass(method: string | undefined): string {
  return method === "embedded" ? "admin-type admin-type-whatsapp" : "admin-chip admin-chip-muted";
}

export function formatQualityRating(rating: string | null | undefined): string {
  const key = (rating ?? "UNKNOWN").toUpperCase();
  return QUALITY_LABELS[key] ?? "—";
}

export function qualityBadgeClass(rating: string | null | undefined): string {
  return `quality-badge ${qualityClass(rating)}`;
}

export function formatMessagingLimit(account: WhatsAppAccountRow): string {
  if (account.messaging_limit) {
    return `${account.messaging_limit.toLocaleString("ar")} / 24س`;
  }
  if (account.messaging_limit_tier) return account.messaging_limit_tier;
  return "—";
}

export function formatHealthSynced(value: string | null | undefined): string {
  if (!value) return "لم تُزامَن";
  return formatAppTime(value);
}

export function formatCommerceSummary(account: WhatsAppAccountRow): string {
  if (account.commerce_enabled && account.meta_catalog_id) {
    return `مفعّل · ${account.meta_catalog_id}`;
  }
  if (account.meta_catalog_id) return `Catalog: ${account.meta_catalog_id}`;
  if (account.commerce_enabled) return "مفعّل بدون Catalog";
  return "غير مفعّل";
}

export function commerceStatusClass(account: WhatsAppAccountRow): string {
  if (account.commerce_enabled && account.meta_catalog_id) {
    return "admin-status admin-status-active";
  }
  if (account.commerce_enabled || account.meta_catalog_id) {
    return "admin-status admin-status-pending";
  }
  return "admin-status admin-status-offline";
}

export function truncateMetaId(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export { formatWhatsAppStatus, whatsappStatusBadgeClass };
