import i18n from "../i18n";
import { api } from "./api";

export type AnalyticsTab = "live" | "team" | "customers" | "revenue" | "insights";

export type AnalyticsOverview = {
  period_days: number;
  current: {
    messages_inbound: number;
    messages_outbound: number;
    conversations: number;
    new_contacts: number;
    revenue_won: number;
  };
  previous: Record<string, number>;
  changes_pct: Record<string, number | null>;
  sla: {
    first_response_avg_minutes: number | null;
    resolution_avg_minutes: number | null;
    sla_compliance_pct: number | null;
    sla_breaches_open: number;
  };
  csat: {
    average_score: number | null;
    promoters_pct: number | null;
    total_ratings: number;
    by_score: Record<string, number>;
  };
  live: {
    open_conversations: number;
    waiting_team_reply: number;
    messages_today: number;
    inbound_today: number;
    outbound_today: number;
  };
};

export type TimeSeriesPoint = { date: string; inbound: number; outbound: number };

export type AgentRow = {
  membership_id: string;
  user_name: string;
  role: string;
  open_conversations: number;
  closed_conversations: number;
  first_response_avg_minutes: number | null;
  sla_compliance_pct: number | null;
  csat_average: number | null;
  csat_count: number;
  deals_won: number;
};

export type CustomerFunnel = {
  funnel: Array<{ stage: string; label: string; count: number }>;
  period_days: number;
};

export type CampaignAnalytics = {
  summary: {
    campaigns: number;
    recipients: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    delivery_rate: number | null;
    read_rate: number | null;
  };
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    recipients: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    delivery_rate: number | null;
    read_rate: number | null;
  }>;
};

export type RevenueAnalytics = {
  pipeline_value: number;
  won_value: number;
  won_value_change_pct: number | null;
  open_deals: number;
  won_count: number;
  velocity_days: number | null;
  forecast: number;
  funnel: Array<{ stage: string; count: number }>;
};

export type AnalyticsInsight = {
  level: "success" | "warning" | "critical" | "info";
  code: string;
  title: string;
  message: string;
  action_path: string | null;
};

export const STAGE_LABELS: Record<string, string> = {
  get lead() { return i18n.t("crm.stageLead"); },
  get qualified() { return i18n.t("crm.stageQualified"); },
  get proposal() { return i18n.t("crm.stageProposal"); },
  get won() { return i18n.t("crm.stageWon"); },
  get lost() { return i18n.t("crm.stageLost"); }
};

export const DAY_LABELS = {
  get ar() { return ["أحد", "إث", "ثل", "أر", "خم", "جم", "سب"]; },
  get en() { return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; },
  get current() { return i18n.language === "en" ? this.en : this.ar; }
};

export function formatChange(value: number | null | undefined) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

export function changeClass(value: number | null | undefined) {
  if (value == null) return "";
  if (value > 0) return "analytics-change-up";
  if (value < 0) return "analytics-change-down";
  return "";
}

export async function downloadAnalyticsExport(path: string, filename: string) {
  const response = await api.get(`${path}?format=xlsx`, { responseType: "arraybuffer" });
  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
