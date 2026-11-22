import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";
import type { ListSectionDraft } from "../lib/inboxComposerStorage";

type Props = {
  open: boolean;
  conversationId: string | null;
  organizationId: string | null;
  onClose: () => void;
  onSent: () => void;
};

type LibraryItem = {
  id: string;
  name: string;
  body: string;
  button_text: string;
  sections: Array<{ title: string; rows_text: string }>;
};

const OPTION_SLOTS_MIN = 3;
const OPTION_SLOTS_MAX = 10;
const OPTION_TITLE_MAX = 24;

const emptySection = (): ListSectionDraft => ({
  title: "الخيارات",
  rowsText: "خيار 1\nخيار 2\nخيار 3"
});

function parseOptionRows(rowsText: string): string[] {
  const rows = rowsText.split(/\n/).map((item) => item.slice(0, OPTION_TITLE_MAX));
  const count = Math.min(OPTION_SLOTS_MAX, Math.max(OPTION_SLOTS_MIN, rows.length || OPTION_SLOTS_MIN));
  return Array.from({ length: count }, (_, index) => rows[index] ?? "");
}

function joinOptionRows(rows: string[]): string {
  const count = Math.min(OPTION_SLOTS_MAX, Math.max(OPTION_SLOTS_MIN, rows.length || OPTION_SLOTS_MIN));
  return Array.from({ length: count }, (_, index) => (rows[index] ?? "").slice(0, OPTION_TITLE_MAX)).join("\n");
}

function toDraftSections(sections: LibraryItem["sections"]): ListSectionDraft[] {
  if (!sections.length) return [emptySection()];
  return sections.map((section) => ({
    title: section.title || "الخيارات",
    rowsText: section.rows_text
  }));
}

export default function InboxListMessagePanel({
  open,
  conversationId,
  organizationId,
  onClose,
  onSent
}: Props) {
  const [mode, setMode] = useState<"library" | "manual">("library");
  const [body, setBody] = useState("اختر من القائمة");
  const [buttonText, setButtonText] = useState("القائمة");
  const [sections, setSections] = useState<ListSectionDraft[]>([emptySection()]);
  const [sending, setSending] = useState(false);

  const libraryQuery = useQuery({
    queryKey: ["composer-list-templates", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data } = await api.get<LibraryItem[]>("/inbox-tools/composer-list-templates", {
        params: { organization_id: organizationId }
      });
      return data;
    }
  });

  useEffect(() => {
    if (!open) setMode("library");
  }, [open]);

  if (!open) return null;

  function applyLibraryItem(item: LibraryItem) {
    setBody(item.body);
    setButtonText(item.button_text);
    setSections(toDraftSections(item.sections));
    setMode("manual");
  }

  function updateSectionOptions(sectionIndex: number, nextRows: string[]) {
    setSections((current) =>
      current.map((item, i) => (i === sectionIndex ? { ...item, rowsText: joinOptionRows(nextRows) } : item))
    );
  }

  function updateOptionRow(sectionIndex: number, optionIndex: number, value: string) {
    const currentRows = parseOptionRows(sections[sectionIndex]?.rowsText ?? "");
    const next = [...currentRows];
    next[optionIndex] = value.slice(0, OPTION_TITLE_MAX);
    updateSectionOptions(sectionIndex, next);
  }

  function addOptionRow(sectionIndex: number) {
    const currentRows = parseOptionRows(sections[sectionIndex]?.rowsText ?? "");
    if (currentRows.length >= OPTION_SLOTS_MAX) return;
    updateSectionOptions(sectionIndex, [...currentRows, ""]);
  }

  function removeOptionRow(sectionIndex: number, optionIndex: number) {
    const currentRows = parseOptionRows(sections[sectionIndex]?.rowsText ?? "");
    if (currentRows.length <= 1) return;
    const next = currentRows.filter((_, i) => i !== optionIndex);
    while (next.length < OPTION_SLOTS_MIN) next.push("");
    updateSectionOptions(sectionIndex, next);
  }

  async function send() {
    if (!conversationId) return;
    const payloadSections = sections
      .map((section) => {
        const rows = section.rowsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, OPTION_SLOTS_MAX)
          .map((title, index) => ({ id: `row_${section.title}_${index + 1}`, title: title.slice(0, OPTION_TITLE_MAX) }));
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

  const library = libraryQuery.data ?? [];

  return (
    <div className="inbox-reply-buttons-panel">
      <div className="inbox-composer-mode-tabs" role="tablist" aria-label="وضع القائمة">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "library"}
          className={mode === "library" ? "active" : ""}
          onClick={() => setMode("library")}
        >
          من المكتبة
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          className={mode === "manual" ? "active" : ""}
          onClick={() => setMode("manual")}
        >
          تعبئة يدوية
        </button>
      </div>

      {mode === "library" ? (
        <div className="inbox-composer-library">
          {!organizationId ? (
            <p className="hint-text">اختر محادثة مرتبطة بفرع لعرض مكتبة القوائم المشتركة.</p>
          ) : libraryQuery.isLoading ? (
            <p className="hint-text">جاري تحميل المكتبة…</p>
          ) : library.length === 0 ? (
            <p className="hint-text">
              لا توجد قوالب بعد. أنشئها من{" "}
              <Link to="/composer-library">مكتبة الرسائل</Link> ثم عد للاستخدام هنا.
            </p>
          ) : (
            <div className="inbox-composer-library-list">
              {library.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="inbox-composer-library-card"
                  onClick={() => applyLibraryItem(item)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.body}</span>
                  <small>
                    {item.button_text} ·{" "}
                    {item.sections.reduce((n, s) => n + s.rows_text.split("\n").filter(Boolean).length, 0)} خيار
                  </small>
                </button>
              ))}
            </div>
          )}
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={() => setMode("manual")}>
              تعبئة يدوية
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              إغلاق
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="field-label">
            <span>نص الرسالة</span>
            <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} />
          </label>
          <label className="field-label">
            <span>نص زر القائمة</span>
            <input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={20} />
          </label>
          {sections.map((section, index) => {
            const optionRows = parseOptionRows(section.rowsText);
            return (
              <div key={index} className="inbox-list-section">
                <label className="field-label">
                  <span>عنوان القسم {index + 1}</span>
                  <input
                    value={section.title}
                    onChange={(e) =>
                      setSections((current) =>
                        current.map((item, i) => (i === index ? { ...item, title: e.target.value } : item))
                      )
                    }
                    maxLength={24}
                  />
                </label>
                <div className="field-label inbox-button-titles">
                  <span>خيارات القسم (حتى {OPTION_SLOTS_MAX})</span>
                  <div className="inbox-button-title-rows" role="group" aria-label={`خيارات القسم ${index + 1}`}>
                    {optionRows.map((title, optionIndex) => (
                      <div key={optionIndex} className="inbox-list-option-row">
                        <label className="inbox-button-title-row">
                          <span className="inbox-button-title-index" aria-hidden="true">
                            {optionIndex + 1}
                          </span>
                          <input
                            type="text"
                            value={title}
                            onChange={(e) => updateOptionRow(index, optionIndex, e.target.value)}
                            placeholder={`خيار ${optionIndex + 1}`}
                            maxLength={OPTION_TITLE_MAX}
                            aria-label={`خيار ${optionIndex + 1} في القسم ${index + 1}`}
                          />
                        </label>
                        {optionRows.length > 1 && (
                          <button
                            type="button"
                            className="secondary-action inbox-list-option-remove"
                            onClick={() => removeOptionRow(index, optionIndex)}
                            aria-label={`حذف الخيار ${optionIndex + 1}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={optionRows.length >= OPTION_SLOTS_MAX}
                    onClick={() => addOptionRow(index)}
                  >
                    + خيار إضافي
                  </button>
                </div>
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
            );
          })}
          <button
            type="button"
            className="secondary-button"
            disabled={sections.length >= 10}
            onClick={() => setSections((current) => [...current, emptySection()])}
          >
            + قسم إضافي
          </button>
          <p className="hint-text">
            لإدارة القوالب (تعديل / أرشفة / حذف) من{" "}
            <Link to="/composer-library">مكتبة الرسائل</Link> فقط.
          </p>
          <div className="inline-actions">
            <button type="button" className="whatsapp-button" disabled={sending} onClick={() => void send()}>
              {sending ? "جاري الإرسال…" : "إرسال القائمة"}
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              إغلاق
            </button>
          </div>
        </>
      )}
    </div>
  );
}
