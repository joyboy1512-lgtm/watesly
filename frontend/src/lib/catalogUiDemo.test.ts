import { describe, expect, it } from "vitest";
import {
  emptyCatalogVisibilityScope,
  filterCatalogByVisibility,
  summarizeCatalogVisibility
} from "./catalogHelpers";
import { buildCatalogUiDemoProducts, buildCatalogUiDemoProofs } from "./catalogUiDemo";

describe("catalog UI demo fixture", () => {
  it("has 32 products with 30 active and broken filterable", () => {
    const rows = buildCatalogUiDemoProducts();
    expect(rows).toHaveLength(32);
    expect(rows.filter((item) => item.is_active)).toHaveLength(30);
    expect(rows.filter((item) => !item.is_active)).toHaveLength(2);

    const scope = emptyCatalogVisibilityScope({
      channelId: "ch-a",
      organizationId: "org-a",
      accountId: "wa-a",
      metaCatalogId: "cat-a",
      isCatalogVisible: true,
      catalogLinked: true,
      proofsByProductId: buildCatalogUiDemoProofs()
    });
    const summary = summarizeCatalogVisibility(rows, scope);
    expect(summary.total).toBe(32);
    expect(summary.counts.confirmed).toBe(5);
    expect(summary.counts.broken).toBeGreaterThan(0);
    expect(filterCatalogByVisibility(rows, "broken", scope).length).toBe(summary.counts.broken);
    expect(summary.cards.find((card) => card.status === "confirmed")?.displayCount).toBe(5);
  });
});
