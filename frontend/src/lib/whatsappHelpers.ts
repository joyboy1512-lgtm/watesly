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
  meta_phone_status?: string | null;
  meta_name_status?: string | null;
  meta_can_send_message?: string | null;
  meta_account_review_status?: string | null;
  meta_status_message?: string | null;
  meta_catalog_id?: string | null;
  commerce_enabled?: boolean;
  catalog_synced_at?: string | null;
  profile_image_url?: string | null;
  profile_image_synced_at?: string | null;
  catalog_cover_image_url?: string | null;
  meta_catalog_product_set_id?: string | null;
  catalog_cover_synced_at?: string | null;
};

export function whatsappAccountLabel(account: Pick<WhatsAppAccountRow, "verified_name" | "display_phone_number" | "channel_name">): string {
  return account.verified_name?.trim() || account.display_phone_number?.trim() || account.channel_name?.trim() || "WhatsApp";
}

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

export type MetaHealthSeverity = "ok" | "warning" | "critical";

export function getMetaHealthSeverity(account: WhatsAppAccountRow): MetaHealthSeverity {
  const canSend = (account.meta_can_send_message ?? "").toUpperCase();
  const nameStatus = (account.meta_name_status ?? "").toUpperCase();
  const phoneStatus = (account.meta_phone_status ?? "").toUpperCase();
  if (canSend === "BLOCKED" || phoneStatus === "DISCONNECTED" || phoneStatus === "BANNED") {
    return "critical";
  }
  if (canSend === "LIMITED" || nameStatus === "DECLINED" || nameStatus === "PENDING") {
    return "warning";
  }
  if (!account.health_synced_at) return "warning";
  return "ok";
}

export function formatMetaHealthShort(account: WhatsAppAccountRow): string {
  const severity = getMetaHealthSeverity(account);
  if (severity === "critical") return "Meta ✗";
  if (severity === "warning") return "Meta !";
  return "Meta ✓";
}

export function formatMetaHealthLabel(account: WhatsAppAccountRow): string {
  if (account.meta_status_message?.trim()) return account.meta_status_message;
  const canSend = (account.meta_can_send_message ?? "").toUpperCase();
  if (canSend === "AVAILABLE") return "متاح — Meta";
  if (canSend === "LIMITED") return "مقيّد — Meta";
  if (canSend === "BLOCKED") return "معطّل — Meta";
  return "غير مُزامَن";
}

export function metaHealthBadgeClass(account: WhatsAppAccountRow): string {
  const severity = getMetaHealthSeverity(account);
  if (severity === "critical") return "meta-health-badge meta-health-critical";
  if (severity === "warning") return "meta-health-badge meta-health-warning";
  return "meta-health-badge meta-health-ok";
}

export function formatMetaHealthDetails(account: WhatsAppAccountRow): string {
  const parts = [
    account.meta_can_send_message ? `إرسال: ${account.meta_can_send_message}` : null,
    account.meta_phone_status ? `رقم: ${account.meta_phone_status}` : null,
    account.meta_name_status ? `اسم: ${account.meta_name_status}` : null,
    account.meta_account_review_status ? `WABA: ${account.meta_account_review_status}` : null
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

export function formatCommerceSummary(account: WhatsAppAccountRow): string {
  if (account.commerce_enabled && account.meta_catalog_id) {
    return `مفعّل · ${account.meta_catalog_id}`;
  }
  if (account.meta_catalog_id) return `Catalog: ${account.meta_catalog_id}`;
  if (account.commerce_enabled) return "مفعّل بدون Catalog";
  return "غير مفعّل";
}

export function formatCommerceShort(account: WhatsAppAccountRow): string {
  if (account.commerce_enabled && account.meta_catalog_id) return "مفعّل";
  if (account.meta_catalog_id) return "Catalog";
  if (account.commerce_enabled) return "بدون Catalog";
  return "—";
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
