import { describe, expect, it } from "vitest";

const memoryStore = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, String(value));
    },
    removeItem: (key: string) => {
      memoryStore.delete(key);
    },
    clear: () => memoryStore.clear(),
    key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
    get length() {
      return memoryStore.size;
    }
  },
  configurable: true
});

const {
  formatDeliveryRate,
  formatReadRate,
  normalizeCampaignRatePercent
} = await import("./campaignHelpers");

describe("normalizeCampaignRatePercent", () => {
  it("keeps 0–100 percentages", () => {
    expect(normalizeCampaignRatePercent(85.4)).toBe(85);
  });

  it("converts 0–1 fractions", () => {
    expect(normalizeCampaignRatePercent(0.854)).toBe(85);
  });
});

describe("formatDeliveryRate / formatReadRate", () => {
  const report = {
    total: 1000,
    sent: 50,
    delivered: 553,
    read: 397,
    failed: 0,
    delivery_rate: 95.0,
    read_rate: 41.79
  };

  it("shows delivered count with percent", () => {
    expect(formatDeliveryRate(report.delivery_rate, report)).toBe("950 · 95%");
  });

  it("shows read count with percent", () => {
    expect(formatReadRate(report.read_rate, report)).toBe("397 · 42%");
  });

  it("falls back to dash when empty", () => {
    expect(
      formatDeliveryRate(0, { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 })
    ).toBe("—");
  });
});
