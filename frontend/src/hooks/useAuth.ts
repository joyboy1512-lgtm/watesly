import { useSyncExternalStore } from "react";
import { authStore } from "../stores/auth";

export function useAuth() {
  return useSyncExternalStore(
    authStore.subscribe,
    authStore.getState,
    authStore.getState
  );
}
