import { useSyncExternalStore } from "react";
import { workspaceStore } from "../stores/workspace";

export function useWorkspaceOrganizationId() {
  return useSyncExternalStore(
    workspaceStore.subscribe,
    () => workspaceStore.getState().selectedOrganizationId,
    () => ""
  );
}

export function useSetWorkspaceOrganization() {
  return workspaceStore.getState().setSelectedOrganizationId;
}
