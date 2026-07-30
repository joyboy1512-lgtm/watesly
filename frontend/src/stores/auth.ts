import { createStore } from "zustand/vanilla";

type AuthState = {
  accessToken: string | null;
  setAccessToken: (accessToken: string) => void;
  setTokens: (accessToken: string, _refreshToken?: string | null) => void;
  logout: () => void;
};

export const authStore = createStore<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
  setTokens: (accessToken) => set({ accessToken }),
  logout: () => set({ accessToken: null })
}));
