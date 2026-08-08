import { HEADER_FORMAT_LABELS, getTemplateHeaderInfo, type TemplateComponent } from "./templateMedia";

export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  paused: "موقوف",
  disabled: "معطّل"
};

export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  marketing: "تسويق",
  utility: "خدمات",
  authentication: "تحقق"
};

export function formatTemplateStatus(status: string): string {
  return TEMPLATE_STATUS_LABELS[status] ?? status;
}

export function formatTemplateCategory(category: string): string {
  return TEMPLATE_CATEGORY_LABELS[category] ?? category;
}

export function templateStatusBadgeClass(status: string): string {
  switch (status) {
    case "approved":
      return "admin-status admin-status-active";
    case "pending":
      return "admin-status admin-status-pending";
    case "rejected":
    case "disabled":
      return "admin-status admin-status-danger";
    case "paused":
      return "admin-status admin-status-offline";
    default:
      return "admin-chip admin-chip-muted";
  }
}

export function templateCategoryBadgeClass(category: string): string {
  switch (category) {
    case "marketing":
      return "admin-type admin-type-whatsapp";
    case "utility":
      return "admin-chip admin-chip-muted";
    case "authentication":
      return "admin-status admin-status-pending";
    default:
      return "admin-chip admin-chip-muted";
  }
}

export function formatTemplateHeader(components: TemplateComponent[] | null | undefined): string {
  const header = getTemplateHeaderInfo(components);
  if (!header) return "—";
  return HEADER_FORMAT_LABELS[header.format] ?? header.format;
}

export function truncateTemplateBody(body: string | null | undefined, max = 72): string {
  if (!body?.trim()) return "—";
  const trimmed = body.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function computeTemplateStats(items: { status: string; category: string }[]) {
  return {
    total: items.length,
    approved: items.filter((item) => item.status === "approved").length,
    pending: items.filter((item) => item.status === "pending").length,
    rejected: items.filter((item) => item.status === "rejected").length,
    marketing: items.filter((item) => item.category === "marketing").length
  };
}
