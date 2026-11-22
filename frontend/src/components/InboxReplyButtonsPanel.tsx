import { useEffect, useState } from "react";
import { toastStore } from "../stores/toast";
import {
  deleteButtonTemplate,
  loadButtonTemplates,
  saveButtonTemplate,
  type ButtonTemplate
} from "../lib/inboxComposerStorage";

type Props = {
  open: boolean;
  body: string;
  titles: string;
  sending: boolean;
  onBodyChange: (value: string) => void;
  onTitlesChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
};

export default function InboxReplyButtonsPanel({
  open,
  body,
  titles,
  sending,
  onBodyChange,
  onTitlesChange,
  onSend,
  onClose
}: Props) {
  const [templates, setTemplates] = useState<ButtonTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    if (open) setTemplates(loadButtonTemplates());
  }, [open]);

  if (!open) return null;

  return (
    <div className="inbox-reply-buttons-panel">
      {templates.length > 0 && (
        <div className="inbox-template-chips">
          <span className="field-label-title">قوالب أزرار محفوظة</span>
          <div className="inline-actions">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="quick-reply-chip"
                onClick={() => {
                  onBodyChange(template.body);
                  onTitlesChange(template.titles);
                }}
              >
                {template.name}
                <span
                  className="inbox-template-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplates(deleteButtonTemplate(template.id));
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field-label">
        <span>نص الرسالة</span>
        <textarea
          rows={2}
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="اختر أحد الخيارات…"
          maxLength={1024}
        />
      </label>
      <label className="field-label">
        <span>نصوص الأزرار (سطر لكل زر · حتى 3)</span>
        <textarea rows={3} value={titles} onChange={(e) => onTitlesChange(e.target.value)} maxLength={80} />
      </label>
      <div className="inbox-template-save-row">
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="اسم القالب لحفظه"
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!templateName.trim()}
          onClick={() => {
            setTemplates(
              saveButtonTemplate({
                name: templateName.trim(),
                body,
                titles
              })
            );
            setTemplateName("");
            toastStore.getState().show("تم حفظ قالب الأزرار.", "success");
          }}
        >
          حفظ كقالب
        </button>
      </div>
      <div className="inline-actions">
        <button type="button" className="whatsapp-button" disabled={sending} onClick={onSend}>
          {sending ? "جاري الإرسال…" : "إرسال الأزرار"}
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>
          إغلاق
        </button>
      </div>
    </div>
  );
}
