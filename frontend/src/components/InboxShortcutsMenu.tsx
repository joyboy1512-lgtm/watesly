type Props = {
  open: boolean;
  onClose: () => void;
  onCreateDeal: () => void;
  onCreateTicketNote: () => void;
  onCreateOrderNote: () => void;
  disabled?: boolean;
};

export default function InboxShortcutsMenu({
  open,
  onClose,
  onCreateDeal,
  onCreateTicketNote,
  onCreateOrderNote,
  disabled
}: Props) {
  if (!open) return null;
  return (
    <div className="inbox-shortcuts-menu" role="menu">
      <button type="button" role="menuitem" disabled={disabled} onClick={() => { onCreateDeal(); onClose(); }}>
        💼 إنشاء صفقة CRM
      </button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => { onCreateTicketNote(); onClose(); }}>
        🎫 تذكرة دعم (ملاحظة)
      </button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => { onCreateOrderNote(); onClose(); }}>
        📦 طلب / أوردر (ملاحظة)
      </button>
    </div>
  );
}
