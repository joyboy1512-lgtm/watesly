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
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 48);
}
