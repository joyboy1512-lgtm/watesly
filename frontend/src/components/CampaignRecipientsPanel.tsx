import { Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  CAMPAIGN_STATUS_LABELS,
  campaignReportNeedsRefresh,
  campaignResultToneClass,
  campaignSentCount,
  campaignStatusBadgeClass,
  formatCampaignCompleted,
  formatCampaignSchedule,
  formatCampaignStatus,
  formatDeliveryRate,
  formatReadRate,
  getCampaignResultLabel,
  isActiveCampaignStatus
} from "../lib/campaignHelpers";
import { toastStore } from "../stores/toast";

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

export { isActiveCampaignStatus, campaignReportNeedsRefresh, CAMPAIGN_STATUS_LABELS };

export function CampaignResultBadge({
  status,
  report
}: {
  status: string;
  report?: Pick<CampaignReport, "total" | "sent" | "delivered" | "read" | "failed" | "pending">;
}) {
  const result = getCampaignResultLabel(status, report);
  return (
    <div className={`campaign-result-badge ${campaignResultToneClass(result.tone)}`}>
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
      <div className="admin-table-wrap">
        <table className="admin-erp-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الرقم</th>
              <th>الحالة</th>
              <th>ملاحظة</th>
            </tr>
          </thead>
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
          <article className="metric-card">
            <span>تم الإرسال</span>
            <strong>{campaignSentCount(report)}</strong>
          </article>
          <article className="metric-card"><span>فشل</span><strong>{report.failed}</strong></article>
          <article className="metric-card"><span>لم يُرسل بعد</span><strong>{report.pending ?? notSent.length}</strong></article>
        </div>
      )}
      <div className="inline-actions">
        <button type="button" className="whatsapp-button compact" onClick={() => void downloadCampaignRecipients(campaignId, "xlsx")}>
          تصدير Excel
        </button>
        <button type="button" className="secondary-button compact" onClick={() => void downloadCampaignRecipients(campaignId, "csv")}>
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
  started_at?: string | null;
  completed_at?: string | null;
  template_name?: string | null;
  account_label?: string | null;
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

type CampaignRowActions = {
  onFollowUp?: (campaignId: string, type: "not_delivered" | "not_read" | "failed") => void;
  onPause?: (campaignId: string) => void;
  onCancel?: (campaignId: string) => void;
  actionBusyId?: string | null;
};

export function CampaignReportRow({
  item,
  expanded,
  onToggle,
  autoRefresh = false,
  actions
}: {
  item: CampaignSummaryRow;
  expanded: boolean;
  onToggle: () => void;
  autoRefresh?: boolean;
  actions?: CampaignRowActions;
}) {
  const summaryReport = buildSummaryReport(item);
  const isActive = isActiveCampaignStatus(item.status);
  const needsRefresh = campaignReportNeedsRefresh(item);
  const busy = actions?.actionBusyId === item.id;

  const report = useQuery({
    queryKey: ["campaign-report", item.id],
    queryFn: async () => (await api.get<CampaignReport>(`/campaigns/${item.id}/report`)).data,
    enabled: expanded || autoRefresh || isActive || needsRefresh,
    refetchInterval: isActive || needsRefresh ? 3000 : false
  });

  const liveReport = report.data ?? summaryReport;
  const sentCount = campaignSentCount(liveReport);
  const showDetails = expanded || isActive || needsRefresh || ["completed", "completed_with_errors", "failed"].includes(item.status);
  const canFollowUp = ["completed", "completed_with_errors", "failed"].includes(item.status);

  return (
    <Fragment>
      <tr className={isActive ? "campaign-row-active" : undefined}>
        <td>
          <div className="admin-cell-main">
            <strong>{item.name}</strong>
            {item.template_name && <small>{item.template_name}</small>}
          </div>
        </td>
        <td>
          <span className={campaignStatusBadgeClass(item.status)}>
            {formatCampaignStatus(item.status)}
          </span>
        </td>
        <td>
          <CampaignResultBadge status={item.status} report={liveReport} />
        </td>
        <td>
          {item.account_label ? (
            <div className="admin-cell-stack">
              <strong dir="ltr">{item.account_label}</strong>
            </div>
          ) : (
            <span className="admin-chip admin-chip-muted">—</span>
          )}
        </td>
        <td>{formatCampaignSchedule(item.scheduled_at, item.started_at)}</td>
        <td>{formatCampaignCompleted(item.completed_at)}</td>
        <td>{liveReport.total.toLocaleString("ar")}</td>
        <td>{sentCount.toLocaleString("ar")}</td>
        <td>{formatDeliveryRate(liveReport.delivery_rate, liveReport)}</td>
        <td>{formatReadRate(liveReport.read_rate, liveReport)}</td>
        <td>{liveReport.failed.toLocaleString("ar")}</td>
        <td>
          <div className="admin-actions campaign-row-actions">
            <button type="button" className="secondary-button compact" onClick={onToggle}>
              {expanded ? "إخفاء" : "تقرير"}
            </button>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => void downloadCampaignRecipients(item.id, "xlsx")}
            >
              Excel
            </button>
            {isActive && actions?.onPause && (
              <button
                type="button"
                className="secondary-button compact"
                disabled={busy}
                onClick={() => actions.onPause?.(item.id)}
              >
                إيقاف
              </button>
            )}
            {isActive && actions?.onCancel && (
              <button
                type="button"
                className="secondary-button compact"
                disabled={busy}
                onClick={() => actions.onCancel?.(item.id)}
              >
                إلغاء
              </button>
            )}
            {canFollowUp && actions?.onFollowUp && (
              <>
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={busy}
                  onClick={() => actions.onFollowUp?.(item.id, "not_delivered")}
                >
                  متابعة
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {showDetails && (expanded || isActive) && (
        <tr className="campaign-expand-row">
          <td colSpan={12}>
            <CampaignRecipientsPanel campaignId={item.id} status={item.status} report={liveReport} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function CampaignResultsTable({
  items,
  expandedCampaignId,
  onToggleExpanded,
  emptyLabel = "لا توجد حملات.",
  autoRefresh = false,
  actions
}: {
  items: CampaignSummaryRow[];
  expandedCampaignId: string | null;
  onToggleExpanded: (id: string) => void;
  emptyLabel?: string;
  autoRefresh?: boolean;
  actions?: CampaignRowActions;
}) {
  if (!items.length) {
    return <p className="admin-table-empty">{emptyLabel}</p>;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-erp-table campaigns-erp-table">
        <thead>
          <tr>
            <th>الحملة / القالب</th>
            <th>الحالة</th>
            <th>النتيجة</th>
            <th>حساب WhatsApp</th>
            <th>البدء</th>
            <th>الانتهاء</th>
            <th>إجمالي</th>
            <th>مرسل</th>
            <th>تسليم</th>
            <th>قراءة</th>
            <th>فشل</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <CampaignReportRow
              key={item.id}
              item={item}
              expanded={expandedCampaignId === item.id}
              onToggle={() => onToggleExpanded(item.id)}
              autoRefresh={autoRefresh}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useCampaignActions() {
  const client = useQueryClient();

  async function pauseCampaign(campaignId: string) {
    try {
      await api.post(`/campaigns/${campaignId}/pause`);
      toastStore.getState().show("تم إيقاف الحملة.", "success");
      await client.invalidateQueries({ queryKey: ["campaigns"] });
    } catch {
      toastStore.getState().show("تعذر إيقاف الحملة.", "error");
    }
  }

  async function cancelCampaign(campaignId: string) {
    const reason = window.prompt("سبب الإلغاء (اختياري):", "إلغاء من لوحة الحملات");
    if (reason === null) return;
    try {
      await api.post(`/campaigns/${campaignId}/cancel`, { reason: reason.trim() || "إلغاء من لوحة الحملات" });
      toastStore.getState().show("تم إلغاء الحملة.", "success");
      await client.invalidateQueries({ queryKey: ["campaigns"] });
    } catch {
      toastStore.getState().show("تعذر إلغاء الحملة.", "error");
    }
  }

  return { pauseCampaign, cancelCampaign };
}
