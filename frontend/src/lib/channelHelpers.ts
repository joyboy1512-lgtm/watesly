export type ChannelType = "whatsapp" | "telegram" | "instagram" | "messenger" | "email";

export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  instagram: "Instagram",
  messenger: "Messenger",
  email: "Email"
};

export const CHANNEL_PURPOSES: Record<string, string> = {
  whatsapp: "محادثات · حملات · قوالب · أتمتة · CRM",
  telegram: "رسائل فورية · دعم العملاء",
  instagram: "رسائل Direct · تفاعل العملاء",
  messenger: "Messenger · ردود وخدمة",
  email: "بريد · تذاكر ومتابعة"
};

export const CHANNEL_STATUS_LABELS: Record<string, string> = {
  pending: "قيد الإعداد",
  active: "نشطة",
  disconnected: "غير متصلة",
  suspended: "موقوفة"
};

export function formatChannelType(type: string): string {
  return CHANNEL_TYPE_LABELS[type] ?? type;
}

export function channelPurpose(type: string): string {
  return CHANNEL_PURPOSES[type] ?? "—";
}

export function formatChannelStatus(status: string): string {
  return CHANNEL_STATUS_LABELS[status] ?? status;
}

export function channelStatusClass(status: string): string {
  switch (status) {
    case "active":
      return "admin-status admin-status-active";
    case "pending":
      return "admin-status admin-status-pending";
    case "disconnected":
      return "admin-status admin-status-offline";
    case "suspended":
      return "admin-status admin-status-danger";
    default:
      return "admin-status";
  }
}

export function channelTypeClass(type: string): string {
  switch (type) {
    case "whatsapp":
      return "admin-type admin-type-whatsapp";
    default:
      return "admin-type";
  }
}

export function formatMacCycleMonth(cycleMonth: string): string {
  const [year, month] = cycleMonth.split("-").map(Number);
  if (!year || !month) return cycleMonth;
  return new Intl.DateTimeFormat("ar", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

export function macUsagePercent(used: number, included: number): number {
  if (included <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / included) * 100));
}

export function macBalanceClass(isOver: boolean, used: number, included: number): string {
  if (isOver) return "admin-status admin-status-danger";
  if (included > 0 && used / included >= 0.85) return "admin-status admin-status-pending";
  return "admin-status admin-status-active";
}

export function formatMacBalance(used: number, included: number): string {
  return `${used.toLocaleString("ar")} / ${included.toLocaleString("ar")} MAC`;
}
