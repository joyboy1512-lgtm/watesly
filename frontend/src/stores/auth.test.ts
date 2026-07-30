import { describe, expect, it } from "vitest";
import { authStore } from "./auth";

describe("authStore", () => {
  it("keeps access token in memory and clears it", () => {
    authStore.getState().setAccessToken("token");
    expect(authStore.getState().accessToken).toBe("token");
    authStore.getState().logout();
    expect(authStore.getState().accessToken).toBeNull();
  });
});
