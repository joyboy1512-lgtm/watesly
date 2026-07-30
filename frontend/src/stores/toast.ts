import { create } from "zustand";

export type ToastTone = "success" | "error" | "info";
export type ToastItem = { id: string; message: string; tone: ToastTone };

type ToastState = {
  items: ToastItem[];
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: string) => void;
};

export const toastStore = create<ToastState>((set) => ({
  items: [],
  show: (message, tone = "info") => {
    const id = crypto.randomUUID();
    set((state) => ({ items: [...state.items, { id, message, tone }] }));
    window.setTimeout(() => set((state) => ({ items: state.items.filter((item) => item.id !== id) })), 4500);
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
}));
