import { describe, expect, it } from "vitest";
import { buildStoredComponents, normalizeShopUrl } from "./templateMedia";

describe("normalizeShopUrl", () => {
  it("returns null for empty input", () => {
    expect(normalizeShopUrl("")).toBeNull();
    expect(normalizeShopUrl("   ")).toBeNull();
    expect(normalizeShopUrl(null)).toBeNull();
  });

  it("adds https when protocol is missing", () => {
    expect(normalizeShopUrl("shop.example.com/sale")).toBe("https://shop.example.com/sale");
  });

  it("keeps https and http URLs", () => {
    expect(normalizeShopUrl("https://shop.example.com")).toBe("https://shop.example.com/");
    expect(normalizeShopUrl("http://shop.example.com")).toBe("http://shop.example.com/");
  });

  it("rejects invalid URLs", () => {
    expect(normalizeShopUrl("not a url")).toBeNull();
  });
});

describe("buildStoredComponents shop CTA", () => {
  it("adds a URL button for shop CTA", () => {
    const components = buildStoredComponents("عرض خاص", null, null, {
      shopUrl: "https://shop.example.com",
      shopButtonText: "تسوق الآن"
    });
    const buttons = components.find((item) => item.type === "BUTTONS")?.buttons ?? [];
    expect(buttons).toEqual([
      { type: "URL", text: "تسوق الآن", url: "https://shop.example.com/" }
    ]);
  });

  it("keeps shop URL with marketing quick replies within Meta's 3-button limit", () => {
    const components = buildStoredComponents("عرض خاص", null, null, {
      includeMarketingOptOut: true,
      category: "marketing",
      shopUrl: "https://shop.example.com/offer",
      shopButtonText: "تسوق الآن"
    });
    const buttons = components.find((item) => item.type === "BUTTONS")?.buttons ?? [];
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toMatchObject({ type: "URL", text: "تسوق الآن" });
    expect(buttons[1]).toMatchObject({ type: "QUICK_REPLY", text: "مهتم" });
    expect(buttons[2]).toMatchObject({ type: "QUICK_REPLY", text: "عدم الإزعاج" });
    expect(components.some((item) => item.type === "FOOTER")).toBe(true);
  });

  it("defaults shop button text to تسوق الآن", () => {
    const components = buildStoredComponents("مرحبا", null, null, {
      shopUrl: "https://example.com"
    });
    const buttons = components.find((item) => item.type === "BUTTONS")?.buttons ?? [];
    expect(buttons[0]?.text).toBe("تسوق الآن");
  });
});
