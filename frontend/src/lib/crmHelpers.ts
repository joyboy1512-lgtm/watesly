import i18n from "../i18n";
import { api } from "./api";

export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";

export type Deal = {
  id: string;
  title: string;
  stage: DealStage;
  amount: string;
  currency: string;
  pipeline: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  organization_id: string | null;
  organization_name?: string | null;
  assigned_membership_id: string | null;
  description: string | null;
  probability: number;
  source: string | null;
  expected_close_date: string | null;
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
};

export type CrmReport = {
  summary: CrmStats;
  top_open: Deal[];
  recent_won: Deal[];
  funnel: Array<{ stage: string; count: number }>;
};

export const DEAL_STAGES: DealStage[] = ["lead", "qualified", "proposal", "won", "lost"];

export const STAGE_LABELS: Record<DealStage, string> = {
  get lead() { return i18n.t("crm.stageLead"); },
  get qualified() { return i18n.t("crm.stageQualified"); },
  get proposal() { return i18n.t("crm.stageProposal"); },
  get won() { return i18n.t("crm.stageWon"); },
  get lost() { return i18n.t("crm.stageLost"); }
};

export const STAGE_COLORS: Record<DealStage, string> = {
  lead: "crm-stage-lead",
  qualified: "crm-stage-qualified",
  proposal: "crm-stage-proposal",
  won: "crm-stage-won",
  lost: "crm-stage-lost"
};

export function formatDealAmount(deal: Pick<Deal, "amount" | "currency">) {
  const value = Number(deal.amount);
  if (Number.isNaN(value)) return deal.amount;
  return `${value.toLocaleString("ar")} ${deal.currency || "KWD"}`;
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

export async function bulkUpdateDealStage(dealIds: string[], stage: DealStage) {
  return (await api.post<{ updated: number }>("/platform/crm/deals/bulk-stage", { deal_ids: dealIds, stage })).data;
}

export async function createDealFromConversation(conversationId: string, title?: string) {
  return (
    await api.post<Deal>("/platform/crm/deals/from-conversation", {
      conversation_id: conversationId,
      title: title || null
    })
  ).data;
}
