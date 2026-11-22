import { useEffect, useState } from "react";
import { toastStore } from "../stores/toast";
import {
  deleteButtonTemplate,
  loadButtonTemplates,
  saveButtonTemplate,
  type ButtonTemplate
} from "../lib/inboxComposerStorage";

const BUTTON_SLOTS = 3;
const BUTTON_TITLE_MAX = 20;

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

function parseButtonTitles(titles: string): string[] {
  const rows = titles.split(/\n/).map((item) => item.slice(0, BUTTON_TITLE_MAX));
  return Array.from({ length: BUTTON_SLOTS }, (_, index) => rows[index] ?? "");
}

function joinButtonTitles(rows: string[]): string {
  const trimmed = rows.map((item) => item.trim());
  while (trimmed.length > 0 && !trimmed[trimmed.length - 1]) trimmed.pop();
  return trimmed.join("\n");
}

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
  const buttonRows = parseButtonTitles(titles);

  useEffect(() => {
    if (open) setTemplates(loadButtonTemplates());
  }, [open]);

  function updateButtonRow(index: number, value: string) {
    const next = [...buttonRows];
    next[index] = value.slice(0, BUTTON_TITLE_MAX);
    onTitlesChange(joinButtonTitles(next));
  }

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
      <div className="field-label inbox-button-titles">
        <span>نصوص الأزرار (حتى 3)</span>
        <div className="inbox-button-title-rows" role="group" aria-label="نصوص الأزرار">
          {buttonRows.map((title, index) => (
            <label key={index} className="inbox-button-title-row">
              <span className="inbox-button-title-index" aria-hidden="true">
                {index + 1}
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => updateButtonRow(index, e.target.value)}
                placeholder={`نص الزر ${index + 1}`}
                maxLength={BUTTON_TITLE_MAX}
                aria-label={`نص الزر ${index + 1}`}
              />
            </label>
          ))}
        </div>
      </div>
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
