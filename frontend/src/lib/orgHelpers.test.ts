import { describe, expect, it } from "vitest";
import { slugFromName } from "./orgHelpers";

describe("slugFromName", () => {
  it("normalizes latin names", () => {
    expect(slugFromName("Three Shiny")).toBe("three-shiny");
  });

  it("falls back when arabic-only name has no latin slug", () => {
    expect(slugFromName("ثري شايني")).toMatch(/^branch-[a-z0-9]+$/);
  });
});
