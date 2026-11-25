import { describe, expect, it } from "vitest";
import {
  catalogWhatsAppVisibility,
  filterCatalogByVisibility,
  summarizeCatalogVisibility,
  type CatalogProduct
} from "./catalogHelpers";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: overrides.id ?? "p1",
    organization_id: null,
    channel_id: null,
    name: "Test",
    sku: null,
    product_type: "product",
    description: null,
    price: "10",
    currency: "KWD",
    price_type: "fixed",
    specs_json: {},
    keywords: null,
    image_url: null,
    category: null,
    meta_retailer_id: null,
    meta_item_group_id: null,
    variant_size: null,
    variant_color: null,
    variant_attributes: {},
    external_source: null,
    external_id: null,
    meta_sync_status: null,
    meta_review_status: null,
    meta_synced_at: null,
    meta_sync_error: null,
    meta_review_detail: null,
    meta_sync_enabled: true,
    usage_count: 0,
    is_active: true,
    sort_order: 0,
    ...overrides
  };
}

describe("catalogWhatsAppVisibility", () => {
  it("treats Meta ID alone as linked, not confirmed", () => {
    const info = catalogWhatsAppVisibility(
      product({ external_id: "meta-123", meta_sync_status: "synced", meta_review_status: null })
    );
    expect(info.status).toBe("linked");
    expect(info.reason).toContain("لا يكفي");
  });

  it("confirms only from review sources that affirm availability", () => {
    expect(
      catalogWhatsAppVisibility(
        product({ external_id: "1", meta_review_status: "approved", meta_synced_at: "2026-11-25T00:00:00Z" })
      ).status
    ).toBe("confirmed");
    expect(catalogWhatsAppVisibility(product({ external_id: "1", meta_review_status: "no_review" })).status).toBe(
      "confirmed"
    );
  });

  it("marks archived, disabled, failed, and rejected as broken", () => {
    expect(catalogWhatsAppVisibility(product({ is_active: false })).status).toBe("broken");
    expect(catalogWhatsAppVisibility(product({ meta_sync_enabled: false, external_id: "1" })).status).toBe("broken");
    expect(catalogWhatsAppVisibility(product({ meta_sync_status: "failed" })).status).toBe("broken");
    expect(catalogWhatsAppVisibility(product({ external_id: "1", meta_review_status: "rejected" })).status).toBe(
      "broken"
    );
  });

  it("keeps retailer-only products local", () => {
    expect(catalogWhatsAppVisibility(product({ meta_retailer_id: "sku-1" })).status).toBe("local");
  });

  it("summarizes a 26-product fixture with 5 confirmed without mutating", () => {
    const rows: CatalogProduct[] = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push(product({ id: `c${i}`, external_id: `m${i}`, meta_review_status: "approved" }));
    }
    for (let i = 0; i < 6; i += 1) {
      rows.push(product({ id: `l${i}`, external_id: `x${i}`, meta_review_status: "pending" }));
    }
    for (let i = 0; i < 7; i += 1) {
      rows.push(product({ id: `loc${i}`, meta_retailer_id: `r${i}` }));
    }
    for (let i = 0; i < 5; i += 1) {
      rows.push(product({ id: `b${i}`, meta_sync_status: "failed", meta_sync_error: "err" }));
    }
    for (let i = 0; i < 3; i += 1) {
      rows.push(product({ id: `u${i}`, external_id: `o${i}`, meta_review_status: "outdated" }));
    }
    expect(rows).toHaveLength(26);
    const summary = summarizeCatalogVisibility(rows);
    expect(summary.counts.confirmed).toBe(5);
    expect(summary.counts.linked).toBe(6);
    expect(summary.counts.local).toBe(7);
    expect(summary.counts.broken).toBe(5);
    expect(summary.counts.unknown).toBe(3);
    expect(filterCatalogByVisibility(rows, "confirmed")).toHaveLength(5);
    expect(filterCatalogByVisibility(rows, "confirmed").every((p) => p.meta_review_status === "approved")).toBe(true);
    // Remaining 21 are classifiable without sync.
    expect(26 - summary.counts.confirmed).toBe(21);
    expect(
      filterCatalogByVisibility(rows, "all")
        .filter((p) => catalogWhatsAppVisibility(p).status !== "confirmed")
        .every((p) => ["local", "linked", "broken", "unknown"].includes(catalogWhatsAppVisibility(p).status))
    ).toBe(true);
  });
});
