export type AssignmentStrategy = "round_robin" | "least_open";

export type AssignmentTeam = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  membership_ids: string[];
};

export type AssignmentRule = {
  id: string;
  organization_id: string;
  channel_id: string | null;
  team_id: string;
  name: string;
  strategy: AssignmentStrategy;
  priority: number;
  is_active: boolean;
};

export type WorkloadRow = {
  membership_id: string;
  role: string;
  open_conversations: number;
};

export const STRATEGY_LABELS: Record<AssignmentStrategy, string> = {
  round_robin: "توزيع بالتناوب",
  least_open: "الأقل محادثات مفتوحة"
};

export const STRATEGY_HINTS: Record<AssignmentStrategy, string> = {
  round_robin: "يوزّع المحادثات بالدور على أعضاء الفريق بالتساوي.",
  least_open: "يُرسل المحادثة للموظف الأقل حملاً ضمن نفس الفرع."
};

export function formatStrategy(strategy: string): string {
  return STRATEGY_LABELS[strategy as AssignmentStrategy] ?? strategy;
}

export function employeesForBranch<T extends { membership_id: string; status: string; organization_ids?: string[] }>(
  employees: T[],
  organizationId: string
): T[] {
  if (!organizationId) return [];
  return employees.filter(
    (item) => item.status === "active" && (item.organization_ids ?? []).includes(organizationId)
  );
}

export function channelsForBranch<T extends { id: string; organization_id: string }>(
  channels: T[],
  organizationId: string
): T[] {
  if (!organizationId) return channels;
  return channels.filter((item) => item.organization_id === organizationId);
}

export function teamsForBranch(teams: AssignmentTeam[], organizationId: string): AssignmentTeam[] {
  if (!organizationId) return teams;
  return teams.filter((item) => item.organization_id === organizationId);
}
