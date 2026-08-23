export const ORG_STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  suspended: "موقوف"
};

export function formatOrgStatus(status: string): string {
  return ORG_STATUS_LABELS[status] ?? status;
}

export function orgStatusClass(status: string): string {
  return status === "active" ? "admin-status admin-status-active" : "admin-status admin-status-danger";
}

export function slugFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (normalized.length >= 2) return normalized;
  return `branch-${Date.now().toString(36)}`;
}

export function organizationCreateErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "object" && detail !== null && "message" in detail) {
      const message = String((detail as { message?: string }).message ?? "").trim();
      if (message) return message;
    }
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return "تعذر إضافة الفرع.";
}
