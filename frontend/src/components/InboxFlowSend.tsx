import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";

type FlowRow = { id: string; name?: string; status?: string };
type WhatsAppAccount = { id: string; channel_id: string };

type Props = {
  open: boolean;
  channelId: string | null;
  contactAddress: string | null;
  onClose: () => void;
};

export default function InboxFlowSend({ open, channelId, contactAddress, onClose }: Props) {
  const [flowId, setFlowId] = useState("");
  const [sending, setSending] = useState(false);

  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    enabled: open,
    queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data
  });

  const accountId = useMemo(
    () => (accounts.data ?? []).find((item) => item.channel_id === channelId)?.id ?? "",
    [accounts.data, channelId]
  );

  const flows = useQuery({
    queryKey: ["whatsapp-flows", accountId],
    enabled: open && Boolean(accountId),
    queryFn: async () => (await api.get<FlowRow[]>(`/whatsapp/accounts/${accountId}/flows`)).data
  });

  if (!open) return null;

  async function send() {
    if (!accountId || !flowId || !contactAddress) return;
    setSending(true);
    try {
      await api.post(`/whatsapp/accounts/${accountId}/flows/send`, {
        to: contactAddress,
        flow_id: flowId
      });
      toastStore.getState().show("تم إرسال الـ Flow.", "success");
      onClose();
    } catch {
      toastStore.getState().show("تعذر إرسال الـ Flow.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="inbox-reply-buttons-panel">
      <label className="field-label">
        <span>WhatsApp Flow</span>
        <select value={flowId} onChange={(e) => setFlowId(e.target.value)}>
          <option value="">اختر Flow</option>
          {(flows.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.id} {item.status ? `· ${item.status}` : ""}
            </option>
          ))}
        </select>
      </label>
      {!accountId && <p className="hint-text">لا يوجد حساب WhatsApp مرتبط بهذه القناة.</p>}
      <div className="inline-actions">
        <button
          type="button"
          className="whatsapp-button"
          disabled={!flowId || sending || !accountId}
          onClick={() => void send()}
        >
          {sending ? "جاري الإرسال…" : "إرسال Flow"}
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>
          إغلاق
        </button>
      </div>
    </div>
  );
}
