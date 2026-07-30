import i18n from "../i18n";
import { api } from "./api";
import { changeClass, formatChange } from "./analyticsHelpers";

export type ReportTabId =
  | "executive"
  | "overview"
  | "customers"
  | "compliance"
  | "names"
  | "engagement"
  | "inactivity"
  | "campaigns"
  | "roi"
  | "conversations"
  | "team"
  | "quick-replies"
  | "automations"
  | "whatsapp"
  | "catalog"
  | "knowledge"
  | "crm"
  | "audit";

export type ReportTab = {
  id: ReportTabId;
  label: string;
  period?: boolean;
  exportPath?: string;
  analyticsLink?: string;
};

export const REPORT_TABS: ReportTab[] = [
  { id: "executive", get label() { return i18n.t("reports.tabExecutive"); }, period: true, exportPath: "/reports/executive/export" },
  { id: "overview", get label() { return i18n.t("reports.tabOverview"); }, period: true, exportPath: "/reports/overview/export", analyticsLink: "/analytics?tab=live" },
  { id: "customers", get label() { return i18n.t("reports.tabCustomers"); }, period: true, exportPath: "/reports/customers/export" },
  { id: "compliance", get label() { return i18n.t("reports.tabCompliance"); }, exportPath: "/reports/compliance/export" },
  { id: "names", get label() { return i18n.t("reports.tabNames"); }, exportPath: "/reports/names/export" },
  { id: "engagement", get label() { return i18n.t("reports.tabEngagement"); }, period: true, exportPath: "/reports/engagement/export" },
  { id: "inactivity", get label() { return i18n.t("reports.tabInactivity"); }, period: true, exportPath: "/reports/inactivity/export" },
  { id: "campaigns", get label() { return i18n.t("reports.tabCampaigns"); }, period: true, exportPath: "/reports/campaigns/export" },
  { id: "roi", get label() { return i18n.t("reports.tabRoi"); }, period: true, exportPath: "/reports/roi/export", analyticsLink: "/analytics?tab=customers" },
  { id: "conversations", get label() { return i18n.t("reports.tabConversations"); }, period: true, exportPath: "/reports/conversations/export", analyticsLink: "/analytics?tab=live" },
  { id: "team", get label() { return i18n.t("reports.tabTeam"); }, period: true, exportPath: "/reports/team/export", analyticsLink: "/analytics?tab=team" },
  { id: "quick-replies", get label() { return i18n.t("reports.tabQuickReplies"); }, exportPath: "/reports/quick-replies/export" },
  { id: "automations", get label() { return i18n.t("reports.tabAutomations"); }, period: true, exportPath: "/reports/automations/export" },
  { id: "whatsapp", get label() { return i18n.t("reports.tabWhatsapp"); }, exportPath: "/reports/whatsapp/export" },
  { id: "catalog", get label() { return i18n.t("reports.tabCatalog"); }, exportPath: "/reports/catalog/export" },
  { id: "knowledge", get label() { return i18n.t("reports.tabKnowledge"); }, exportPath: "/reports/knowledge/export" },
  { id: "crm", get label() { return i18n.t("reports.tabCrm"); }, exportPath: "/platform/crm/deals/export", analyticsLink: "/analytics?tab=revenue" },
  { id: "audit", get label() { return i18n.t("reports.tabAudit"); }, period: true, exportPath: "/reports/audit/export" }
];

export type ContactRow = {
  id: string;
  display_name: string | null;
  phone: string;
  email: string | null;
  country_code?: string | null;
  created_at: string | null;
  last_message_at?: string | null;
  waiting_minutes?: number | null;
  status?: string | null;
  conversation_id?: string;
};

export async function downloadReport(path: string, filename: string, format: "xlsx" | "csv", days?: number) {
  const sep = path.includes("?") ? "&" : "?";
  const daysParam = days != null ? `&days=${days}` : "";
  const response = await api.get(`${path}${sep}format=${format}${daysParam}`, { responseType: "arraybuffer" });
  const mime =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv;charset=utf-8";
  const blob = new Blob([response.data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export { changeClass, formatChange };

export function loadSavedReportTab(): ReportTabId | null {
  try {
    const value = localStorage.getItem("reports:last-tab");
    return REPORT_TABS.some((t) => t.id === value) ? (value as ReportTabId) : null;
  } catch {
    return null;
  }
}

export function saveReportTab(tab: ReportTabId) {
  try {
    localStorage.setItem("reports:last-tab", tab);
  } catch {
    /* ignore */
  }
}
