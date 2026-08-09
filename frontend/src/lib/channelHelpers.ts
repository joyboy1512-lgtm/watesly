export type ChannelType = "whatsapp" | "telegram" | "instagram" | "messenger" | "email";

export type ChannelRow = {
  channel_id: string;
  channel_name: string;
  organization_id: string;
  channel_type: string;
  channel_status: string;
  external_id: string | null;
  cycle_month: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  campaign_messages_sent: number;
  whatsapp_status: string | null;
  whatsapp_phone: string | null;
  whatsapp_verified_name: string | null;
  subscription_starts_at?: string | null;
  subscription_ends_at?: string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  over_mac_price_per_100?: number;
  attributed_over_mac_count?: number;
  estimated_channel_over_mac_charge?: number;
};

export type BasicChannel = {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  external_id: string | null;
  status: string;
};

export type ChannelUsageBoard = {
  cycle_month: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  over_mac_blocks: number;
  over_mac_price_per_100: number;
  estimated_over_mac_charge: number;
  subscription_starts_at?: string | null;
  subscription_ends_at?: string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  channels: ChannelRow[];
};

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

export const CHANNEL_TYPE_HINTS: Record<string, string> = {
  whatsapp: "القناة الرئيسية للمحادثات والحملات عبر WhatsApp Business API.",
  telegram: "استقبال وإرسال رسائل Telegram للدعم.",
  instagram: "ردود رسائل Instagram Direct من صندوق الوارد.",
  messenger: "إدارة محادثات Facebook Messenger.",
  email: "قناة بريد للمتابعة والتذاكر."
};

export const CHANNEL_CAPABILITIES: Record<string, string[]> = {
  whatsapp: ["صندوق الوارد", "حملات جماعية", "قوالب Meta", "أتمتة", "CRM", "MAC"],
  telegram: ["صندوق الوارد", "ردود فورية"],
  instagram: ["صندوق الوارد", "Direct"],
  messenger: ["صندوق الوارد", "ردود"],
  email: ["صندوق الوارد", "متابعة"]
};

export const CHANNEL_STATUS_LABELS: Record<string, string> = {
  pending: "قيد الإعداد",
  active: "نشطة",
  disconnected: "غير متصلة",
  suspended: "موقوفة"
};

export const CHANNEL_TYPE_OPTIONS: ChannelType[] = [
  "whatsapp",
  "telegram",
  "instagram",
  "messenger",
  "email"
];

export function formatChannelType(type: string): string {
  return CHANNEL_TYPE_LABELS[type] ?? type;
}

export function channelPurpose(type: string): string {
  return CHANNEL_PURPOSES[type] ?? "—";
}

export function channelTypeHint(type: string): string {
  return CHANNEL_TYPE_HINTS[type] ?? "";
}

export function channelCapabilities(type: string): string[] {
  return CHANNEL_CAPABILITIES[type] ?? [];
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

export function channelsForBranch<T extends { organization_id: string }>(
  channels: T[],
  organizationId: string
): T[] {
  if (!organizationId) return channels;
  return channels.filter((item) => item.organization_id === organizationId);
}

export function mergeChannelRows(
  basic: BasicChannel[],
  board: ChannelUsageBoard | undefined
): ChannelRow[] {
  const boardById = new Map((board?.channels ?? []).map((item) => [item.channel_id, item]));
  const cycle = board?.cycle_month ?? new Date().toISOString().slice(0, 7);
  const includedDefault = board?.included_mac ?? 0;

  return basic.map((channel) => {
    const existing = boardById.get(channel.id);
    if (existing) return existing;
    return {
      channel_id: channel.id,
      channel_name: channel.name,
      organization_id: channel.organization_id,
      channel_type: channel.type,
      channel_status: channel.status,
      external_id: channel.external_id,
      cycle_month: cycle,
      mac_count: 0,
      included_mac: includedDefault,
      mac_remaining: includedDefault,
      is_over_mac: false,
      over_mac_count: 0,
      campaign_messages_sent: 0,
      whatsapp_status: null,
      whatsapp_phone: null,
      whatsapp_verified_name: null
    };
  });
}

export function channelSetupState(rows: ChannelRow[]): {
  ready: boolean;
  title: string;
  detail: string;
  statusLabel: string;
} {
  if (rows.length === 0) {
    return {
      ready: false,
      title: "ابدأ بإضافة قناة",
      detail: "① أنشئ قناة للفرع → ② اربط WhatsApp → ③ استخدمها في الوارد والحملات.",
      statusLabel: "لا توجد قنوات"
    };
  }

  const whatsappRows = rows.filter((item) => item.channel_type === "whatsapp");
  const connected = whatsappRows.filter((item) => item.whatsapp_status === "active").length;
  if (whatsappRows.length > 0 && connected === 0) {
    return {
      ready: false,
      title: "اربط WhatsApp Business",
      detail: "القنوات موجودة لكن WhatsApp غير متصل — أكمل الربط لاستقبال المحادثات.",
      statusLabel: "يتطلب ربط"
    };
  }

  return {
    ready: true,
    title: "القنوات جاهزة للعمل",
    detail: "يمكنك استقبال المحادثات، إرسال الحملات، وربط قواعد التوزيع.",
    statusLabel: "جاهز"
  };
}
