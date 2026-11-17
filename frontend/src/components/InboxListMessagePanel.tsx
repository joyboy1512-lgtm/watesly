import { useState } from "react";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";

type Props = {
  open: boolean;
  conversationId: string | null;
  onClose: () => void;
  onSent: () => void;
};

export default function InboxListMessagePanel({ open, conversationId, onClose, onSent }: Props) {
  const [body, setBody] = useState("اختر من القائمة");
  const [buttonText, setButtonText] = useState("القائمة");
  const [sectionTitle, setSectionTitle] = useState("الخيارات");
  const [rowsText, setRowsText] = useState("خيار 1\nخيار 2\nخيار 3");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  async function send() {
    if (!conversationId) return;
    const rows = rowsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((title, index) => ({ id: `row_${index + 1}`, title: title.slice(0, 24) }));
    if (!rows.length) {
      toastStore.getState().show("أضف صفاً واحداً على الأقل.", "error");
      return;
    }
    setSending(true);
    try {
      await api.post(`/conversations/${conversationId}/messages/list`, {
        body,
        button_text: buttonText.slice(0, 20),
        sections: [{ title: sectionTitle.slice(0, 24), rows }]
      });
      toastStore.getState().show("تم إرسال القائمة.", "success");
      onSent();
      onClose();
    } catch {
      toastStore.getState().show("تعذر إرسال القائمة — تأكد من نافذة 24 ساعة.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="inbox-reply-buttons-panel">
      <label className="field-label">
        <span>نص الرسالة</span>
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} />
      </label>
      <label className="field-label">
        <span>نص زر القائمة</span>
        <input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={20} />
      </label>
      <label className="field-label">
        <span>عنوان القسم</span>
        <input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} maxLength={24} />
      </label>
      <label className="field-label">
        <span>صفوف القائمة (سطر لكل خيار)</span>
        <textarea rows={4} value={rowsText} onChange={(e) => setRowsText(e.target.value)} />
      </label>
      <div className="inline-actions">
        <button type="button" className="whatsapp-button" disabled={sending} onClick={() => void send()}>
          {sending ? "جاري الإرسال…" : "إرسال القائمة"}
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>
          إغلاق
        </button>
      </div>
    </div>
  );
}
