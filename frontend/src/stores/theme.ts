import { createStore } from "zustand/vanilla";

type Theme = "light" | "dark";

type ThemeState = {
  theme: Theme;
  toggleTheme: () => void;
};

const stored = ((localStorage.getItem("watesly_theme") ?? localStorage.getItem("mywat_theme")) as Theme | null) ?? "light";
document.documentElement.dataset.theme = stored;

export const themeStore = createStore<ThemeState>((set, get) => ({
  theme: stored,
  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    localStorage.setItem("watesly_theme", next);
    document.documentElement.dataset.theme = next;
    set({ theme: next });
  }
}));
