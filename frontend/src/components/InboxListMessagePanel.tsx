import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";
import {
  deleteListTemplate,
  loadListTemplates,
  saveListTemplate,
  type ListSectionDraft,
  type ListTemplate
} from "../lib/inboxComposerStorage";

type Props = {
  open: boolean;
  conversationId: string | null;
  onClose: () => void;
  onSent: () => void;
};

const emptySection = (): ListSectionDraft => ({ title: "الخيارات", rowsText: "خيار 1\nخيار 2\nخيار 3" });

export default function InboxListMessagePanel({ open, conversationId, onClose, onSent }: Props) {
  const [body, setBody] = useState("اختر من القائمة");
  const [buttonText, setButtonText] = useState("القائمة");
  const [sections, setSections] = useState<ListSectionDraft[]>([emptySection()]);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<ListTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    if (open) setTemplates(loadListTemplates());
  }, [open]);

  if (!open) return null;

  function applyTemplate(template: ListTemplate) {
    setBody(template.body);
    setButtonText(template.buttonText);
    setSections(template.sections.length ? template.sections : [emptySection()]);
  }

  async function send() {
    if (!conversationId) return;
    const payloadSections = sections
      .map((section) => {
        const rows = section.rowsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 10)
          .map((title, index) => ({ id: `row_${section.title}_${index + 1}`, title: title.slice(0, 24) }));
        return {
          title: section.title.slice(0, 24) || "خيارات",
          rows
        };
      })
      .filter((section) => section.rows.length > 0)
      .slice(0, 10);

    if (!payloadSections.length) {
      toastStore.getState().show("أضف صفّاً واحداً على الأقل.", "error");
      return;
    }
    setSending(true);
    try {
      await api.post(`/conversations/${conversationId}/messages/list`, {
        body,
        button_text: buttonText.slice(0, 20),
        sections: payloadSections
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
      {templates.length > 0 && (
        <div className="inbox-template-chips">
          <span className="field-label-title">قوالب محفوظة</span>
          <div className="inline-actions">
            {templates.map((template) => (
              <button key={template.id} type="button" className="quick-reply-chip" onClick={() => applyTemplate(template)}>
                {template.name}
                <span
                  className="inbox-template-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplates(deleteListTemplate(template.id));
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
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} />
      </label>
      <label className="field-label">
        <span>نص زر القائمة</span>
        <input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={20} />
      </label>
      {sections.map((section, index) => (
        <div key={index} className="inbox-list-section">
          <label className="field-label">
            <span>عنوان القسم {index + 1}</span>
            <input
              value={section.title}
              onChange={(e) =>
                setSections((current) => current.map((item, i) => (i === index ? { ...item, title: e.target.value } : item)))
              }
              maxLength={24}
            />
          </label>
          <label className="field-label">
            <span>صفوف القسم (سطر لكل خيار)</span>
            <textarea
              rows={3}
              value={section.rowsText}
              onChange={(e) =>
                setSections((current) =>
                  current.map((item, i) => (i === index ? { ...item, rowsText: e.target.value } : item))
                )
              }
            />
          </label>
          {sections.length > 1 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSections((current) => current.filter((_, i) => i !== index))}
            >
              حذف القسم
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="secondary-button"
        disabled={sections.length >= 10}
        onClick={() => setSections((current) => [...current, emptySection()])}
      >
        + قسم إضافي
      </button>
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
              saveListTemplate({
                name: templateName.trim(),
                body,
                buttonText,
                sections
              })
            );
            setTemplateName("");
            toastStore.getState().show("تم حفظ قالب القائمة.", "success");
          }}
        >
          حفظ كقالب
        </button>
      </div>
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
