type Props = {
  open: boolean;
  note: string;
  reason: string;
  onNoteChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSummarize?: () => void;
  busy?: boolean;
  summarizing?: boolean;
};

const REASONS = ["تم الحل", "لا رد من العميل", "مكرر", "spam", "محوّل لفريق آخر", "أخرى"];

export default function InboxCloseDialog({
  open,
  note,
  reason,
  onNoteChange,
  onReasonChange,
  onCancel,
  onConfirm,
  onSummarize,
  busy,
  summarizing
}: Props) {
  if (!open) return null;
  return (
    <div className="inbox-modal-backdrop" role="dialog" aria-modal="true" aria-label="إغلاق المحادثة">
      <div className="inbox-modal-card">
        <header>
          <h3>إغلاق المحادثة</h3>
          <p>أضف سبباً وملاحظة اختيارية للتحليل لاحقاً.</p>
        </header>
        <label className="field-label">
          <span>سبب الإغلاق</span>
          <select value={reason} onChange={(e) => onReasonChange(e.target.value)}>
            <option value="">— بدون سبب —</option>
            {REASONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>ملاحظة إغلاق</span>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            maxLength={1000}
            placeholder="ماذا تم إنجازه في هذه المحادثة؟"
          />
        </label>
        <div className="admin-actions">
          {onSummarize && (
            <button
              type="button"
              className="secondary-button"
              onClick={onSummarize}
              disabled={busy || summarizing}
            >
              {summarizing ? "جاري التلخيص…" : "تلخيص بالذكاء"}
            </button>
          )}
          <button type="button" className="whatsapp-button" onClick={onConfirm} disabled={busy || summarizing}>
            {busy ? "جاري الإغلاق…" : "إغلاق وإرسال للأرشيف"}
          </button>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy || summarizing}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
