import { api } from "./api";

export function formatWaitingMinutes(minutes: number | null | undefined) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

const messageStatusLabels: Record<string, string> = {
  received: "✓",
  queued: "◷",
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "⚠"
};

export function formatMessageStatus(status: string, direction: string): { label: string; className: string } | null {
  if (direction === "inbound") return null;
  const normalized = status.toLowerCase();
  const label = messageStatusLabels[normalized] ?? status;
  if (normalized === "read") return { label, className: "read" };
  if (normalized === "failed") return { label, className: "failed" };
  if (normalized === "delivered") return { label, className: "delivered" };
  return { label, className: "sent" };
}

export function snoozeUntilTomorrowMorning(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

export async function startConversationOnChannel(payload: {
  channel_id: string;
  external_address: string;
  display_name?: string | null;
}): Promise<{ conversation_id: string; channel_id: string; contact_id: string; created: boolean }> {
  const response = await api.post<{
    conversation_id: string;
    channel_id: string;
    contact_id: string;
    created: boolean;
  }>("/conversations/start", payload);
  return response.data;
}
