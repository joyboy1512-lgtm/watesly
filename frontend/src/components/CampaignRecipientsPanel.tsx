import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export type CampaignReport = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending?: number;
  queued?: number;
  delivery_rate: number;
  read_rate: number;
};

export type CampaignRecipient = {
  contact_id: string;
  display_name: string | null;
  phone: string;
  status: string;
  error_message: string | null;
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

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  pending: "في الانتظار",
  queued: "بالطابور",
  sending: "جاري الإرسال",
  sent: "تم الإرسال",
  delivered: "تم التسليم",
  read: "مقروء",
  failed: "فشل",
  skipped: "تم تخطيه"
};

const SUCCESS_STATUSES = new Set(["sent", "delivered", "read"]);
const PENDING_STATUSES = new Set(["pending", "queued", "sending"]);
const ACTIVE_CAMPAIGN_STATUSES = new Set(["scheduled", "running"]);

export function isActiveCampaignStatus(status: string) {
  return ACTIVE_CAMPAIGN_STATUSES.has(status);
}

function campaignSentCount(report: Pick<CampaignReport, "sent" | "delivered" | "read">) {
  return (report.sent ?? 0) + (report.delivered ?? 0) + (report.read ?? 0);
}

/** Keep polling until Meta/worker counts are reflected in the list report. */
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

export function getCampaignResultLabel(status: string, report?: Pick<CampaignReport, "total" | "sent" | "delivered" | "read" | "failed" | "pending">) {
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
      return { label: CAMPAIGN_STATUS_LABELS[status] ?? status, tone: "muted" as const, detail: pending ? `${pending} متبقي` : "—" };
  }
}

export function CampaignResultBadge({
  status,
  report
}: {
  status: string;
  report?: Pick<CampaignReport, "total" | "sent" | "delivered" | "read" | "failed" | "pending">;
}) {
  const result = getCampaignResultLabel(status, report);
  return (
    <div className={`campaign-result-badge campaign-result-${result.tone}`}>
      <strong>{result.label}</strong>
      <span>{result.detail}</span>
    </div>
  );
}

export async function downloadCampaignRecipients(campaignId: string, format: "xlsx" | "csv") {
  const response = await api.get(`/campaigns/${campaignId}/recipients/export?format=${format}`, {
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
  link.download = `campaign-${campaignId}-recipients.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

function RecipientTable({ title, rows }: { title: string; rows: CampaignRecipient[] }) {
  if (!rows.length) return null;
  return (
    <div className="campaign-recipient-group">
      <h4>{title} ({rows.length})</h4>
      <table>
        <thead><tr><th>الاسم</th><th>الرقم</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
        <tbody>
          {rows.map((item) => (
            <tr key={`${item.contact_id}-${item.status}`}>
              <td>{item.display_name || "—"}</td>
              <td dir="ltr">{item.phone}</td>
              <td>{RECIPIENT_STATUS_LABELS[item.status] ?? item.status}</td>
              <td>{item.error_message || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignRecipientsPanel({
  campaignId,
  status,
  report
}: {
  campaignId: string;
  status?: string;
  report?: CampaignReport;
}) {
  const recipients = useQuery({
    queryKey: ["campaign-recipients", campaignId],
    queryFn: async () => (await api.get<CampaignRecipient[]>(`/campaigns/${campaignId}/recipients`)).data,
    enabled: Boolean(campaignId)
  });

  const rows = recipients.data ?? [];
  const sent = rows.filter((r) => SUCCESS_STATUSES.has(r.status));
  const failed = rows.filter((r) => r.status === "failed");
  const notSent = rows.filter((r) => PENDING_STATUSES.has(r.status));

  return (
    <div className="campaign-details-panel">
      {status && (
        <div className="campaign-result-header">
          <h3 className="section-title-sm">تقرير الحملة</h3>
          <CampaignResultBadge status={status} report={report} />
        </div>
      )}
      {report && (
        <div className="stats-grid campaign-details-stats">
          <article className="metric-card"><span>إجمالي</span><strong>{report.total}</strong></article>
          <article className="metric-card"><span>تم الإرسال</span><strong>{report.sent + report.delivered + report.read}</strong></article>
          <article className="metric-card"><span>فشل</span><strong>{report.failed}</strong></article>
          <article className="metric-card"><span>لم يُرسل بعد</span><strong>{report.pending ?? notSent.length}</strong></article>
        </div>
      )}
      <div className="inline-actions">
        <button type="button" className="whatsapp-button" onClick={() => void downloadCampaignRecipients(campaignId, "xlsx")}>
          تصدير Excel
        </button>
        <button type="button" className="secondary-button" onClick={() => void downloadCampaignRecipients(campaignId, "csv")}>
          CSV
        </button>
      </div>
      {recipients.isLoading && <p className="hint-text">جاري تحميل الأرقام…</p>}
      <RecipientTable title="تم الإرسال لهم" rows={sent} />
      <RecipientTable title="فشل الإرسال" rows={failed} />
      <RecipientTable title="لم يُرسل بعد" rows={notSent} />
      {!recipients.isLoading && !rows.length && <p className="hint-text">لا توجد بيانات مستلمين.</p>}
    </div>
  );
}

export type CampaignSummaryRow = {
  id: string;
  name: string;
  status: string;
  scheduled_at?: string | null;
  completed_at?: string | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending?: number;
};

function buildSummaryReport(item: CampaignSummaryRow, report?: CampaignReport): CampaignReport {
  return {
    total: item.total,
    sent: item.sent,
    delivered: item.delivered,
    read: item.read,
    failed: item.failed,
    pending: report?.pending ?? item.pending ?? Math.max(item.total - item.sent - item.delivered - item.read - item.failed, 0),
    delivery_rate: report?.delivery_rate ?? 0,
    read_rate: report?.read_rate ?? 0
  };
}

export function CampaignReportRow({
  item,
  expanded,
  onToggle,
  showScheduled = false,
  autoRefresh = false
}: {
  item: CampaignSummaryRow;
  expanded: boolean;
  onToggle: () => void;
  showScheduled?: boolean;
  autoRefresh?: boolean;
}) {
  const summaryReport = buildSummaryReport(item);
  const isActive = isActiveCampaignStatus(item.status);
  const needsRefresh = campaignReportNeedsRefresh(item);

  const report = useQuery({
    queryKey: ["campaign-report", item.id],
    queryFn: async () => (await api.get<CampaignReport>(`/campaigns/${item.id}/report`)).data,
    enabled: expanded || autoRefresh || isActive || needsRefresh,
    refetchInterval: isActive || needsRefresh ? 3000 : false
  });

  const liveReport = report.data ?? summaryReport;
  const showDetails = expanded || isActive || needsRefresh || ["completed", "completed_with_errors", "failed"].includes(item.status);

  return (
    <>
      <tr className={isActive ? "campaign-row-active" : undefined}>
        <td><strong>{item.name}</strong></td>
        <td><span className="tag-chip">{CAMPAIGN_STATUS_LABELS[item.status] ?? item.status}</span></td>
        <td>
          <CampaignResultBadge status={item.status} report={liveReport} />
        </td>
        {showScheduled && (
          <td>{item.scheduled_at ? new Date(item.scheduled_at).toLocaleString("ar") : "فوري"}</td>
        )}
        <td>{liveReport.total}</td>
        <td>{liveReport.sent + liveReport.delivered + liveReport.read}</td>
        <td>{liveReport.delivered}</td>
        <td>{liveReport.read}</td>
        <td>{liveReport.failed}</td>
        <td>
          <button type="button" className="secondary-button" onClick={onToggle}>
            {expanded ? "إخفاء التقرير" : "عرض التقرير"}
          </button>
        </td>
      </tr>
      {showDetails && (expanded || isActive) && (
        <tr className="campaign-details-row">
          <td colSpan={showScheduled ? 10 : 9}>
            <CampaignRecipientsPanel
              campaignId={item.id}
              status={item.status}
              report={liveReport}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export function CampaignResultsTable({
  items,
  expandedCampaignId,
  onToggleExpanded,
  showScheduled = false,
  emptyLabel = "لا توجد حملات.",
  autoRefresh = false
}: {
  items: CampaignSummaryRow[];
  expandedCampaignId: string | null;
  onToggleExpanded: (id: string) => void;
  showScheduled?: boolean;
  emptyLabel?: string;
  autoRefresh?: boolean;
}) {
  if (!items.length) return <p className="hint-text">{emptyLabel}</p>;

  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>الحملة</th>
            <th>الحالة</th>
            <th>نتيجة الحملة</th>
            {showScheduled && <th>الموعد</th>}
            <th>إجمالي</th>
            <th>مرسل</th>
            <th>مُسلَّم</th>
            <th>مقروء</th>
            <th>فشل</th>
            <th>التقرير</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <CampaignReportRow
              key={item.id}
              item={item}
              expanded={expandedCampaignId === item.id}
              onToggle={() => onToggleExpanded(item.id)}
              showScheduled={showScheduled}
              autoRefresh={autoRefresh}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
