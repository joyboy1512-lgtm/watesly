import { useEffect, useState } from "react";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "../lib/crmHelpers";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreateDeal: (input: { title: string; amount: string; stage: DealStage }) => void;
  onCreateTicketNote: (details: string) => void;
  onCreateOrderNote: (details: string) => void;
  cartSummary?: string;
  disabled?: boolean;
};

type Mode = "menu" | "deal" | "ticket" | "order";

export default function InboxShortcutsMenu({
  open,
  onClose,
  onCreateDeal,
  onCreateTicketNote,
  onCreateOrderNote,
  cartSummary = "",
  disabled
}: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [dealTitle, setDealTitle] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [dealStage, setDealStage] = useState<DealStage>("lead");
  const [noteDetails, setNoteDetails] = useState("");

  useEffect(() => {
    if (!open) {
      setMode("menu");
      setDealTitle("");
      setDealAmount("");
      setDealStage("lead");
      setNoteDetails("");
    }
  }, [open]);

  if (!open) return null;

  function resetAndClose() {
    setMode("menu");
    setDealTitle("");
    setDealAmount("");
    setDealStage("lead");
    setNoteDetails("");
    onClose();
  }

  if (mode === "deal") {
    return (
      <div className="inbox-shortcuts-menu inbox-shortcuts-form inbox-reply-buttons-panel" role="dialog">
        <div className="inbox-product-picker-head">
          <strong>إنشاء صفقة CRM</strong>
          <button type="button" className="secondary-action" onClick={resetAndClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <label className="field-label">
          <span>عنوان الصفقة</span>
          <input value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} placeholder="اختياري — يُولَّد تلقائياً" disabled={disabled} />
        </label>
        <label className="field-label">
          <span>القيمة</span>
          <input value={dealAmount} onChange={(e) => setDealAmount(e.target.value)} placeholder="مثال: 25" disabled={disabled} />
        </label>
        <label className="field-label">
          <span>المرحلة</span>
          <select value={dealStage} onChange={(e) => setDealStage(e.target.value as DealStage)} disabled={disabled}>
            {DEAL_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-actions">
          <button
            type="button"
            className="whatsapp-button"
            disabled={disabled}
            onClick={() => {
              onCreateDeal({ title: dealTitle.trim(), amount: dealAmount.trim(), stage: dealStage });
              resetAndClose();
            }}
          >
            إنشاء الصفقة
          </button>
          <button type="button" className="secondary-button" onClick={() => setMode("menu")}>
            رجوع
          </button>
        </div>
      </div>
    );
  }

  if (mode === "ticket" || mode === "order") {
    const label = mode === "ticket" ? "تذكرة دعم" : "طلب / أوردر";
    return (
      <div className="inbox-shortcuts-menu inbox-shortcuts-form inbox-reply-buttons-panel" role="dialog">
        <div className="inbox-product-picker-head">
          <strong>{label}</strong>
          <button type="button" className="secondary-action" onClick={resetAndClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <label className="field-label">
          <span>التفاصيل</span>
          <textarea
            rows={3}
            value={noteDetails}
            onChange={(e) => setNoteDetails(e.target.value)}
            placeholder={mode === "order" ? "منتجات، كمية، ملاحظات…" : "مشكلة العميل والخطوات…"}
            disabled={disabled}
          />
        </label>
        {mode === "order" && cartSummary && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setNoteDetails((current) => [current.trim(), cartSummary].filter(Boolean).join("\n"))}
          >
            إضافة ملخص السلة
          </button>
        )}
        <div className="inline-actions">
          <button
            type="button"
            className="whatsapp-button"
            disabled={disabled || !noteDetails.trim()}
            onClick={() => {
              if (mode === "ticket") onCreateTicketNote(noteDetails.trim());
              else onCreateOrderNote(noteDetails.trim());
              resetAndClose();
            }}
          >
            حفظ
          </button>
          <button type="button" className="secondary-button" onClick={() => setMode("menu")}>
            رجوع
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inbox-shortcuts-menu inbox-reply-buttons-panel" role="menu" aria-label="اختصارات سريعة">
      <div className="inbox-product-picker-head">
        <strong>اختصارات سريعة</strong>
        <button type="button" className="secondary-action" onClick={resetAndClose} aria-label="إغلاق">
          ×
        </button>
      </div>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => setMode("deal")}>
        إنشاء صفقة CRM
      </button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => setMode("ticket")}>
        تذكرة دعم
      </button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => setMode("order")}>
        طلب / أوردر
      </button>
    </div>
  );
}
