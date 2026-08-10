import { formatAppTime } from "./language";

export type CampaignReportLike = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending?: number;
  delivery_rate?: number;
  read_rate?: number;
};

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  scheduled: "مجدولة",
  running: "قيد الإرسال",
  completed: "مكتملة",
  completed_with_errors: "مكتملة بأخطاء",
  paused: "موقوفة",
  cancelled: "ملغاة",
  failed: "فشلت"
};

const ACTIVE_CAMPAIGN_STATUSES = new Set(["scheduled", "running"]);

export function isActiveCampaignStatus(status: string) {
  return ACTIVE_CAMPAIGN_STATUSES.has(status);
}

export function campaignSentCount(report: Pick<CampaignReportLike, "sent" | "delivered" | "read">) {
  return (report.sent ?? 0) + (report.delivered ?? 0) + (report.read ?? 0);
}

export function campaignReportNeedsRefresh(item: {
  status: string;
  completed_at?: string | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}) {
  if (isActiveCampaignStatus(item.status)) return true;
  const sentCount = campaignSentCount(item);
  if (item.total === 0) return false;
  if (sentCount > 0 || item.failed > 0) return false;
  if (!["completed", "completed_with_errors"].includes(item.status)) return false;
  if (item.completed_at) {
    const ageMs = Date.now() - new Date(item.completed_at).getTime();
    return ageMs < 120_000;
  }
  return true;
}

export function getCampaignResultLabel(
  status: string,
  report?: Pick<CampaignReportLike, "total" | "sent" | "delivered" | "read" | "failed" | "pending">
) {
  const sentCount = (report?.sent ?? 0) + (report?.delivered ?? 0) + (report?.read ?? 0);
  const total = report?.total ?? 0;
  const failed = report?.failed ?? 0;
  const pending = report?.pending ?? Math.max(total - sentCount - failed, 0);

  switch (status) {
    case "completed":
      if (total > 0 && sentCount === 0 && failed === 0) {
        return {
          label: "جاري التحديث",
          tone: "progress" as const,
          detail: "انتظر ثوانٍ حتى تظهر نتيجة الإرسال"
        };
      }
      if (failed > 0) {
        return {
          label: "تمت بأخطاء",
          tone: "warning" as const,
          detail: `${failed} فشل · ${sentCount}/${total} مرسل`
        };
      }
      return { label: "تمت بنجاح", tone: "success" as const, detail: `${sentCount}/${total} تم الإرسال` };
    case "completed_with_errors":
      return { label: "تمت بأخطاء", tone: "warning" as const, detail: `${failed} فشل · ${sentCount}/${total} مرسل` };
    case "failed":
      return { label: "فشلت", tone: "danger" as const, detail: "تعذّر إكمال الحملة" };
    case "running":
      return { label: "جاري الإرسال", tone: "progress" as const, detail: `${sentCount}/${total} مرسل` };
    case "scheduled":
      return { label: "بانتظار الإرسال", tone: "progress" as const, detail: total ? `${total} مستلم` : "في الطابور" };
    case "paused":
      return { label: "موقوفة", tone: "warning" as const, detail: `${sentCount}/${total} مرسل` };
    case "cancelled":
      return { label: "ملغاة", tone: "muted" as const, detail: "—" };
    case "draft":
      return { label: "مسودة", tone: "muted" as const, detail: total ? `${total} مستلم` : "—" };
    default:
      return {
        label: CAMPAIGN_STATUS_LABELS[status] ?? status,
        tone: "muted" as const,
        detail: pending ? `${pending} متبقي` : "—"
      };
  }
}

export function campaignResultToneClass(tone: "success" | "warning" | "danger" | "progress" | "muted") {
  return `campaign-result-${tone}`;
}

export function campaignStatusBadgeClass(status: string): string {
  switch (status) {
    case "running":
    case "scheduled":
      return "admin-status admin-status-pending";
    case "completed":
      return "admin-status admin-status-active";
    case "completed_with_errors":
    case "paused":
      return "admin-status admin-status-pending";
    case "failed":
      return "admin-status admin-status-danger";
    case "cancelled":
      return "admin-status admin-status-offline";
    default:
      return "admin-chip admin-chip-muted";
  }
}

export function formatCampaignStatus(status: string): string {
  return CAMPAIGN_STATUS_LABELS[status] ?? status;
}

export function formatCampaignSchedule(scheduledAt: string | null | undefined, startedAt?: string | null) {
  if (startedAt) return formatAppTime(startedAt);
  if (scheduledAt) return formatAppTime(scheduledAt);
  return "فوري";
}

export function formatCampaignCompleted(completedAt: string | null | undefined) {
  if (!completedAt) return "—";
  return formatAppTime(completedAt);
}

export function formatDeliveryRate(rate: number | undefined, report?: CampaignReportLike) {
  if (rate != null && rate > 0) return `${Math.round(rate * 100)}%`;
  if (!report || report.total === 0) return "—";
  const sent = campaignSentCount(report);
  if (sent === 0) return "—";
  const delivered = report.delivered + report.read;
  return `${Math.round((delivered / sent) * 100)}%`;
}

export function formatReadRate(rate: number | undefined, report?: CampaignReportLike) {
  if (rate != null && rate > 0) return `${Math.round(rate * 100)}%`;
  if (!report || report.total === 0) return "—";
  const delivered = report.delivered + report.read;
  if (delivered === 0) return "—";
  return `${Math.round((report.read / delivered) * 100)}%`;
}

export function computeCampaignStats(items: { status: string }[]) {
  return {
    total: items.length,
    running: items.filter((item) => isActiveCampaignStatus(item.status)).length,
    completed: items.filter((item) => ["completed", "completed_with_errors"].includes(item.status)).length,
    failed: items.filter((item) => item.status === "failed").length,
    draft: items.filter((item) => item.status === "draft").length
  };
}
