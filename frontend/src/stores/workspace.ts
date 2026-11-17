import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "watesly.selectedOrganizationId";

function readStoredOrganizationId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

type WorkspaceState = {
  selectedOrganizationId: string;
  setSelectedOrganizationId: (organizationId: string) => void;
};

export const workspaceStore = createStore<WorkspaceState>((set) => ({
  selectedOrganizationId: typeof window !== "undefined" ? readStoredOrganizationId() : "",
  setSelectedOrganizationId: (organizationId) => {
    try {
      if (organizationId) localStorage.setItem(STORAGE_KEY, organizationId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ selectedOrganizationId: organizationId });
  }
}));

export function useWorkspaceOrganizationId(): string {
  return workspaceStore.getState().selectedOrganizationId;
}
