import i18n from "../i18n";
import { api } from "./api";

export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";
export type LossReason = "price" | "no_reply" | "unavailable" | "competitor" | "other" | "unspecified";
export type CrmQuickFilter = "my_today" | "overdue" | "unassigned" | "";

export type Deal = {
  id: string;
  title: string;
  stage: DealStage;
  amount: string | null;
  amount_recorded?: boolean;
  currency: string;
  pipeline: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  organization_id: string | null;
  organization_name?: string | null;
  assigned_membership_id: string | null;
  assignee_name?: string | null;
  description: string | null;
  probability: number;
  source: string | null;
  expected_close_date: string | null;
  loss_reason?: LossReason | string | null;
  loss_reason_detail?: string | null;
  next_step?: string | null;
  next_step_at?: string | null;
  conversation_id?: string | null;
  stage_history?: DealActivity[];
  created_at: string | null;
  updated_at: string | null;
};

export type DealActivity = {
  id: string;
  activity_type: string;
  body: string;
  created_by_name: string | null;
  created_at: string | null;
};

export type CrmStats = {
  total: number;
  open: number;
  won_month: number;
  pipeline_value: number;
  won_value_month: number;
  by_stage: Record<string, number>;
  loss_reasons?: Record<string, number>;
  lost_total?: number;
};

export type FollowUpCounts = {
  my_today: number;
  overdue: number;
  unassigned: number;
  lost_total: number;
  loss_reasons: Record<string, number>;
};

export type CrmReport = {
  summary: CrmStats;
  top_open: Deal[];
  recent_won: Deal[];
  funnel: Array<{ stage: string; count: number }>;
};

export const DEAL_STAGES: DealStage[] = ["lead", "qualified", "proposal", "won", "lost"];

export const LOSS_REASONS: LossReason[] = [
  "price",
  "no_reply",
  "unavailable",
  "competitor",
  "other",
  "unspecified"
];

export const STAGE_LABELS: Record<DealStage, string> = {
  get lead() { return i18n.t("crm.stageLead"); },
  get qualified() { return i18n.t("crm.stageQualified"); },
  get proposal() { return i18n.t("crm.stageProposal"); },
  get won() { return i18n.t("crm.stageWon"); },
  get lost() { return i18n.t("crm.stageLost"); }
};

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price: "السعر",
  no_reply: "عدم الرد",
  unavailable: "عدم التوفر",
  competitor: "منافس",
  other: "سبب مخصص",
  unspecified: "غير محدد"
};

export const STAGE_COLORS: Record<DealStage, string> = {
  lead: "crm-stage-lead",
  qualified: "crm-stage-qualified",
  proposal: "crm-stage-proposal",
  won: "crm-stage-won",
  lost: "crm-stage-lost"
};

export function formatDealAmount(deal: Pick<Deal, "amount" | "currency" | "amount_recorded">) {
  if (deal.amount == null || deal.amount_recorded === false) return "قيمة غير مسجّلة";
  const value = Number(deal.amount);
  if (Number.isNaN(value)) return deal.amount;
  return `${value.toLocaleString("ar")} ${deal.currency || "KWD"}`;
}

export function buildCrmQuery(params: Record<string, string | undefined | null>) {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) next.set(key, value);
  });
  return next;
}

export async function downloadDealsExport(dealIds?: string[]) {
  const idsParam = dealIds?.length ? `&ids=${dealIds.join(",")}` : "";
  const response = await api.get(`/platform/crm/deals/export?format=xlsx${idsParam}`, { responseType: "arraybuffer" });
  const blob = new Blob([response.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dealIds?.length ? "crm-deals-selected.xlsx" : "crm-deals.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export async function bulkUpdateDealStage(
  dealIds: string[],
  stage: DealStage,
  extra?: { loss_reason?: string; loss_reason_detail?: string }
) {
  return (
    await api.post<{ updated: number }>("/platform/crm/deals/bulk-stage", {
      deal_ids: dealIds,
      stage,
      ...extra
    })
  ).data;
}

export async function createDealFromConversation(conversationId: string, title?: string) {
  return (
    await api.post<Deal>("/platform/crm/deals/from-conversation", {
      conversation_id: conversationId,
      title: title || null
    })
  ).data;
}
