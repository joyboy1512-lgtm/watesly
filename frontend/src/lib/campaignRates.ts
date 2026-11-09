export type CampaignRateReport = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending?: number;
  delivery_rate?: number;
  read_rate?: number;
};

export function campaignSentCount(report: Pick<CampaignRateReport, "sent" | "delivered" | "read">) {
  return (report.sent ?? 0) + (report.delivered ?? 0) + (report.read ?? 0);
}

/** Normalize API rate: already 0–100, or legacy 0–1 fraction. */
export function normalizeCampaignRatePercent(rate: number | undefined | null): number | null {
  if (rate == null || Number.isNaN(rate)) return null;
  if (rate <= 0) return 0;
  if (rate <= 1) return Math.round(rate * 100);
  return Math.round(rate);
}

export function formatDeliveryRate(rate: number | undefined, report?: CampaignRateReport) {
  if (!report || report.total === 0) {
    const pct = normalizeCampaignRatePercent(rate);
    return pct != null && pct > 0 ? `${pct}%` : "—";
  }
  const sent = campaignSentCount(report);
  const deliveredCount = (report.delivered ?? 0) + (report.read ?? 0);
  if (sent === 0 && deliveredCount === 0) return "—";
  const pct =
    normalizeCampaignRatePercent(rate) ??
    (sent > 0 ? Math.round((deliveredCount / sent) * 100) : null);
  const countLabel = deliveredCount.toLocaleString("ar");
  return pct != null ? `${countLabel} · ${pct}%` : countLabel;
}

export function formatReadRate(rate: number | undefined, report?: CampaignRateReport) {
  if (!report || report.total === 0) {
    const pct = normalizeCampaignRatePercent(rate);
    return pct != null && pct > 0 ? `${pct}%` : "—";
  }
  const readCount = report.read ?? 0;
  const deliveredBase = (report.delivered ?? 0) + readCount;
  if (deliveredBase === 0 && readCount === 0) return "—";
  const pct =
    normalizeCampaignRatePercent(rate) ??
    (deliveredBase > 0 ? Math.round((readCount / deliveredBase) * 100) : null);
  const countLabel = readCount.toLocaleString("ar");
  return pct != null ? `${countLabel} · ${pct}%` : countLabel;
}
