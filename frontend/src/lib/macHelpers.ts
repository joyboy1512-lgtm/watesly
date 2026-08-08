export {
  formatMacBalance,
  formatMacCycleMonth,
  macBalanceClass,
  macUsagePercent
} from "./channelHelpers";

export const MAC_TRIGGER_LABELS: Record<string, string> = {
  inbound: "رسالة واردة",
  inbox_outbound: "رد من Inbox",
  ai_outbound: "رد الذكاء الاصطناعي"
};

export function formatMacTrigger(source: string): string {
  return MAC_TRIGGER_LABELS[source] ?? source;
}

export function formatMacUsagePercent(used: number, included: number): number {
  if (included <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / included) * 100));
}

export function formatMacOverageCharge(estimated: number, isOver: boolean): string {
  if (!isOver) return "$0";
  return `$${estimated.toFixed(2)}`;
}
