import { toastStore } from "../stores/toast";

export default function ToastViewport() {
  const items = toastStore((state) => state.items);
  const dismiss = toastStore((state) => state.dismiss);
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <button key={item.id} className={`toast toast-${item.tone}`} onClick={() => dismiss(item.id)}>
          <span className="toast-dot" />
          <span>{item.message}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  );
}
