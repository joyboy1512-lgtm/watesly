/** 0 means unlimited in plan limits. */
export function formatPlanLimit(value: number, unlimitedLabel = "غير محدود"): string {
  if (value <= 0) return unlimitedLabel;
  return value.toLocaleString("ar");
}
