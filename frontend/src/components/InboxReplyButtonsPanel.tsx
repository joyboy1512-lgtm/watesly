import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

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
  const [mode, setMode] = useState<"library" | "manual">("library");
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
    if (!open) setMode("library");
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
                  <small>{item.titles.split("\n").filter(Boolean).join(" · ")}</small>
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
          <p className="hint-text">
            لإدارة القوالب (تعديل / أرشفة / حذف) من{" "}
            <Link to="/composer-library">مكتبة الرسائل</Link> فقط.
          </p>
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
