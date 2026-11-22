import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";

const BUTTON_SLOTS = 3;
const BUTTON_TITLE_MAX = 20;

type LibraryItem = {
  id: string;
  name: string;
  body: string;
  titles: string;
};

type Props = {
  open: boolean;
  organizationId: string | null;
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
  organizationId,
  body,
  titles,
  sending,
  onBodyChange,
  onTitlesChange,
  onSend,
  onClose
}: Props) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"library" | "manual">("library");
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const buttonRows = parseButtonTitles(titles);

  const libraryQuery = useQuery({
    queryKey: ["composer-button-templates", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data } = await api.get<LibraryItem[]>("/inbox-tools/composer-button-templates", {
        params: { organization_id: organizationId }
      });
      return data;
    }
  });

  useEffect(() => {
    if (!open) {
      setMode("library");
      setTemplateName("");
    }
  }, [open]);

  function updateButtonRow(index: number, value: string) {
    const next = [...buttonRows];
    next[index] = value.slice(0, BUTTON_TITLE_MAX);
    onTitlesChange(joinButtonTitles(next));
  }

  function applyLibraryItem(item: LibraryItem) {
    onBodyChange(item.body);
    onTitlesChange(item.titles);
    setMode("manual");
  }

  async function saveToLibrary() {
    if (!organizationId) {
      toastStore.getState().show("اختر فرعاً أولاً لحفظ القالب في المكتبة.", "error");
      return;
    }
    const name = templateName.trim();
    const cleanTitles = joinButtonTitles(buttonRows);
    if (!name || !body.trim() || !cleanTitles) {
      toastStore.getState().show("أدخل اسم القالب ونص الرسالة وزرّاً واحداً على الأقل.", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/inbox-tools/composer-button-templates", {
        organization_id: organizationId,
        name,
        body: body.trim(),
        titles: cleanTitles
      });
      setTemplateName("");
      await queryClient.invalidateQueries({ queryKey: ["composer-button-templates", organizationId] });
      toastStore.getState().show("تم حفظ القالب في مكتبة الفرع.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ القالب — ربما الاسم مستخدم مسبقاً.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeLibraryItem(id: string) {
    try {
      await api.delete(`/inbox-tools/composer-button-templates/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["composer-button-templates", organizationId] });
      toastStore.getState().show("تم حذف القالب من المكتبة.", "success");
    } catch {
      toastStore.getState().show("تعذر حذف القالب.", "error");
    }
  }

  if (!open) return null;

  const library = libraryQuery.data ?? [];

  return (
    <div className="inbox-reply-buttons-panel">
      <div className="inbox-composer-mode-tabs" role="tablist" aria-label="وضع الأزرار">
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
            <p className="hint-text">اختر محادثة مرتبطة بفرع لعرض مكتبة الأزرار المشتركة.</p>
          ) : libraryQuery.isLoading ? (
            <p className="hint-text">جاري تحميل المكتبة…</p>
          ) : library.length === 0 ? (
            <p className="hint-text">لا توجد قوالب بعد. انتقل للتعبئة اليدوية واحفظ قالباً للمكتبة.</p>
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
                  <small>{item.titles.split("\n").filter(Boolean).join(" · ")}</small>
                  <span
                    className="inbox-template-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeLibraryItem(item.id);
                    }}
                  >
                    ×
                  </span>
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
              placeholder="اسم القالب لحفظه في المكتبة"
            />
            <button
              type="button"
              className="secondary-button"
              disabled={!templateName.trim() || saving || !organizationId}
              onClick={() => void saveToLibrary()}
            >
              {saving ? "جاري الحفظ…" : "حفظ القالب"}
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
        </>
      )}
    </div>
  );
}
