import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";
import {
  FLOW_SCENARIO_DEFAULTS,
  deleteFlowPreset,
  loadFlowPresets,
  saveFlowPreset,
  type FlowPreset
} from "../lib/inboxComposerStorage";

type FlowRow = { id: string; name?: string; status?: string };
type WhatsAppAccount = { id: string; channel_id: string };

type Props = {
  open: boolean;
  channelId: string | null;
  contactAddress: string | null;
  conversationId?: string | null;
  onClose: () => void;
};

export default function InboxFlowSend({ open, channelId, contactAddress, conversationId, onClose }: Props) {
  const [flowId, setFlowId] = useState("");
  const [flowCta, setFlowCta] = useState("ابدأ");
  const [bodyText, setBodyText] = useState("أكمل النموذج التالي.");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<FlowPreset[]>([]);
  const [sending, setSending] = useState(false);
  const [saveCrmNote, setSaveCrmNote] = useState(true);

  useEffect(() => {
    if (open) setPresets(loadFlowPresets());
  }, [open]);

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

  function applyPreset(preset: Pick<FlowPreset, "flowId" | "flowCta" | "bodyText" | "headerText" | "footerText">) {
    if (preset.flowId) setFlowId(preset.flowId);
    setFlowCta(preset.flowCta);
    setBodyText(preset.bodyText);
    setHeaderText(preset.headerText);
    setFooterText(preset.footerText);
  }

  async function send() {
    if (!accountId || !flowId || !contactAddress) return;
    if (!flowCta.trim() || !bodyText.trim()) {
      toastStore.getState().show("أدخل نص الزر ونص الرسالة.", "error");
      return;
    }
    setSending(true);
    try {
      await api.post(`/whatsapp/accounts/${accountId}/flows/send`, {
        to: contactAddress,
        flow_id: flowId,
        flow_cta: flowCta.trim().slice(0, 30),
        body_text: bodyText.trim().slice(0, 1024),
        header_text: headerText.trim().slice(0, 60) || null,
        footer_text: footerText.trim().slice(0, 60) || null
      });
      const flowName = (flows.data ?? []).find((item) => item.id === flowId)?.name || flowId;
      if (saveCrmNote && conversationId) {
        await api.post(`/inbox-tools/conversations/${conversationId}/notes`, {
          body: `Flow أُرسل: ${flowName}`
        });
      }
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
      <div className="inbox-template-chips">
        <span className="field-label-title">سيناريوهات جاهزة</span>
        <div className="inline-actions">
          {FLOW_SCENARIO_DEFAULTS.map((item) => (
            <button
              key={item.name}
              type="button"
              className="quick-reply-chip"
              onClick={() =>
                applyPreset({
                  flowId: flowId,
                  flowCta: item.flowCta,
                  bodyText: item.bodyText,
                  headerText: item.headerText,
                  footerText: item.footerText
                })
              }
            >
              {item.name}
            </button>
          ))}
          {presets.map((preset) => (
            <button key={preset.id} type="button" className="quick-reply-chip" onClick={() => applyPreset(preset)}>
              {preset.name}
              <span
                className="inbox-template-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setPresets(deleteFlowPreset(preset.id));
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      </div>
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
      <label className="field-label">
        <span>نص الزر (CTA)</span>
        <input value={flowCta} onChange={(e) => setFlowCta(e.target.value)} maxLength={30} />
      </label>
      <label className="field-label">
        <span>نص الرسالة</span>
        <textarea rows={2} value={bodyText} onChange={(e) => setBodyText(e.target.value)} maxLength={1024} />
      </label>
      <label className="field-label">
        <span>عنوان (اختياري)</span>
        <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} />
      </label>
      <label className="field-label">
        <span>تذييل (اختياري)</span>
        <input value={footerText} onChange={(e) => setFooterText(e.target.value)} maxLength={60} />
      </label>
      <label className="composer-send-close">
        <input type="checkbox" checked={saveCrmNote} onChange={(e) => setSaveCrmNote(e.target.checked)} />
        <span>حفظ ملاحظة CRM بعد الإرسال</span>
      </label>
      <div className="inbox-template-save-row">
        <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="اسم السيناريو لحفظه" />
        <button
          type="button"
          className="secondary-button"
          disabled={!presetName.trim() || !flowId}
          onClick={() => {
            setPresets(
              saveFlowPreset({
                name: presetName.trim(),
                flowId,
                flowCta,
                bodyText,
                headerText,
                footerText
              })
            );
            setPresetName("");
            toastStore.getState().show("تم حفظ سيناريو Flow.", "success");
          }}
        >
          حفظ سيناريو
        </button>
      </div>
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
