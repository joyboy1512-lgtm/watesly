import { useSyncExternalStore } from "react";
import { themeStore } from "../stores/theme";

export function useTheme() {
  return useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getState,
    themeStore.getState
  );
}
