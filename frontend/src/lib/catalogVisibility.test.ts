import { describe, expect, it } from "vitest";
import {
  catalogWhatsAppVisibility,
  emptyCatalogVisibilityScope,
  filterCatalogByVisibility,
  isValidCatalogVisibilityProof,
  summarizeCatalogVisibility,
  type CatalogProduct,
  type CatalogVisibilityProof,
  type CatalogVisibilityScope
} from "./catalogHelpers";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: overrides.id ?? "p1",
    organization_id: overrides.organization_id ?? "org-1",
    channel_id: overrides.channel_id ?? "ch-a",
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

function proof(overrides: Partial<CatalogVisibilityProof> = {}): CatalogVisibilityProof {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    channelId: "ch-a",
    catalogId: "cat-a",
    productId: "p1",
    verifiedAt: "2026-11-25T08:00:00Z",
    source: "test_fixture",
    ...overrides
  };
}

function scope(overrides: Partial<CatalogVisibilityScope> = {}): CatalogVisibilityScope {
  return emptyCatalogVisibilityScope({
    channelId: "ch-a",
    organizationId: "org-1",
    accountId: "wa-a",
    metaCatalogId: "cat-a",
    isCatalogVisible: true,
    catalogLinked: true,
    proofsByProductId: {},
    ...overrides
  });
}

describe("catalogWhatsAppVisibility proof semantics", () => {
  it("treats Meta ID alone as linked, not confirmed", () => {
    const info = catalogWhatsAppVisibility(
      product({ external_id: "meta-123", meta_sync_status: "synced", meta_review_status: null }),
      scope()
    );
    expect(info.status).toBe("linked");
    expect(info.reason).toContain("لا يكفي");
  });

  it("does not confirm from approved or no_review alone", () => {
    expect(
      catalogWhatsAppVisibility(
        product({
          external_id: "1",
          meta_review_status: "approved",
          meta_synced_at: "2026-11-25T00:00:00Z"
        }),
        scope()
      ).status
    ).toBe("meta_approved");
    expect(
      catalogWhatsAppVisibility(product({ external_id: "1", meta_review_status: "no_review" }), scope()).status
    ).toBe("meta_approved");
    expect(
      catalogWhatsAppVisibility(product({ external_id: "1", meta_review_status: "approved" }), scope()).label
    ).toContain("الظهور غير متحقق");
  });

  it("confirms only with channel-scoped visibility proof", () => {
    const row = product({
      id: "p1",
      external_id: "1",
      meta_review_status: "approved",
      meta_synced_at: "2026-11-20T00:00:00Z"
    });
    const withProof = scope({ proofsByProductId: { p1: proof({ productId: "p1" }) } });
    const info = catalogWhatsAppVisibility(row, withProof);
    expect(info.status).toBe("confirmed");
    expect(info.lastUpdateKind).toBe("visibility_check");
    expect(info.lastUpdateLabel).toBe("آخر تحقق من الظهور");
    expect(info.lastVisibilityCheckedAt).toBe("2026-11-25T08:00:00Z");
    expect(info.lastSyncedAt).toBe("2026-11-20T00:00:00Z");
  });

  it("labels meta_synced_at as last sync when no visibility check exists", () => {
    const info = catalogWhatsAppVisibility(
      product({ external_id: "1", meta_review_status: "approved", meta_synced_at: "2026-11-21T00:00:00Z" }),
      scope()
    );
    expect(info.lastUpdateKind).toBe("sync");
    expect(info.lastUpdateLabel).toBe("آخر مزامنة");
    expect(info.lastVisibilityCheckedAt).toBeNull();
  });

  it("rejects proof from another channel or catalog", () => {
    const row = product({ id: "p1", channel_id: "ch-a", meta_review_status: "approved", external_id: "1" });
    expect(
      isValidCatalogVisibilityProof(
        proof({ channelId: "ch-b", catalogId: "cat-a", productId: "p1" }),
        row,
        scope({ channelId: "ch-a", metaCatalogId: "cat-a" })
      )
    ).toBe(false);
    expect(
      isValidCatalogVisibilityProof(
        proof({ channelId: "ch-a", catalogId: "cat-b", productId: "p1" }),
        row,
        scope({ channelId: "ch-a", metaCatalogId: "cat-a" })
      )
    ).toBe(false);
  });

  it("does not confirm when phone catalog is hidden even with membership proof", () => {
    const row = product({ id: "p1", meta_review_status: "approved", external_id: "1" });
    const info = catalogWhatsAppVisibility(
      row,
      scope({
        isCatalogVisible: false,
        proofsByProductId: { p1: proof({ productId: "p1" }) }
      })
    );
    expect(info.status).toBe("meta_approved");
    expect(info.status).not.toBe("confirmed");
  });

  it("excludes products assigned to another WhatsApp number in the same branch", () => {
    const otherNumber = product({
      id: "p2",
      channel_id: "ch-b",
      organization_id: "org-1",
      meta_review_status: "approved",
      external_id: "2"
    });
    const info = catalogWhatsAppVisibility(
      otherNumber,
      scope({
        channelId: "ch-a",
        proofsByProductId: {
          p2: proof({ productId: "p2", channelId: "ch-a", catalogId: "cat-a" })
        }
      })
    );
    expect(info.status).toBe("unknown");
    expect(info.reason).toContain("رقم واتساب آخر");
  });

  it("distinguishes sync failure and sync pause from proven hidden", () => {
    expect(
      catalogWhatsAppVisibility(product({ meta_sync_status: "failed", meta_sync_error: "timeout" }), scope()).status
    ).toBe("unknown");
    expect(
      catalogWhatsAppVisibility(product({ meta_sync_status: "failed" }), scope()).reason
    ).toContain("تعطلت المزامنة");
    expect(
      catalogWhatsAppVisibility(product({ meta_sync_enabled: false, external_id: "1" }), scope()).status
    ).toBe("unknown");
    expect(
      catalogWhatsAppVisibility(product({ meta_sync_enabled: false, external_id: "1" }), scope()).reason
    ).toContain("لا يكفي للجزم");
    expect(catalogWhatsAppVisibility(product({ is_active: false }), scope()).status).toBe("broken");
    expect(
      catalogWhatsAppVisibility(product({ external_id: "1", meta_review_status: "rejected" }), scope()).status
    ).toBe("broken");
  });

  it("asks to pick a WhatsApp number when all channels are selected", () => {
    const summary = summarizeCatalogVisibility(
      [product({ external_id: "1", meta_review_status: "approved" })],
      emptyCatalogVisibilityScope()
    );
    expect(summary.requiresChannelSelection).toBe(true);
    expect(summary.counts.confirmed).toBe(0);
    expect(summary.counts.meta_approved).toBe(1);
    expect(
      catalogWhatsAppVisibility(
        product({ external_id: "1", meta_review_status: "approved" }),
        emptyCatalogVisibilityScope()
      ).nextStep
    ).toContain("اختر رقم واتساب");
  });

  it("summarizes a 26-product fixture with 5 channel proofs and classifies the rest", () => {
    const rows: CatalogProduct[] = [];
    const proofsByProductId: Record<string, CatalogVisibilityProof> = {};
    for (let i = 0; i < 5; i += 1) {
      const id = `c${i}`;
      rows.push(
        product({
          id,
          channel_id: "ch-a",
          external_id: `m${i}`,
          meta_review_status: "approved",
          meta_synced_at: "2026-11-20T00:00:00Z"
        })
      );
      proofsByProductId[id] = proof({ productId: id, channelId: "ch-a", catalogId: "cat-a" });
    }
    for (let i = 0; i < 4; i += 1) {
      rows.push(
        product({
          id: `ap${i}`,
          channel_id: "ch-a",
          external_id: `ap${i}`,
          meta_review_status: "approved"
        })
      );
    }
    for (let i = 0; i < 5; i += 1) {
      rows.push(product({ id: `l${i}`, channel_id: "ch-a", external_id: `x${i}`, meta_review_status: "pending" }));
    }
    for (let i = 0; i < 5; i += 1) {
      rows.push(product({ id: `loc${i}`, channel_id: "ch-a", meta_retailer_id: `r${i}` }));
    }
    for (let i = 0; i < 3; i += 1) {
      rows.push(product({ id: `b${i}`, channel_id: "ch-a", meta_sync_status: "failed", meta_sync_error: "err" }));
    }
    for (let i = 0; i < 2; i += 1) {
      rows.push(product({ id: `rj${i}`, channel_id: "ch-a", external_id: `rj${i}`, meta_review_status: "rejected" }));
    }
    for (let i = 0; i < 2; i += 1) {
      rows.push(product({ id: `u${i}`, channel_id: "ch-a", external_id: `o${i}`, meta_review_status: "outdated" }));
    }
    expect(rows).toHaveLength(26);

    const channelScope = scope({ proofsByProductId });
    const summary = summarizeCatalogVisibility(rows, channelScope);
    expect(summary.counts.confirmed).toBe(5);
    expect(summary.counts.meta_approved).toBe(4);
    expect(summary.counts.linked).toBe(5);
    expect(summary.counts.local).toBe(5);
    expect(summary.counts.broken).toBe(2);
    expect(summary.counts.unknown).toBe(5);
    expect(filterCatalogByVisibility(rows, "confirmed", channelScope)).toHaveLength(5);

    // Without any integration proof source, confirmed stays zero.
    const noProofSummary = summarizeCatalogVisibility(rows, scope({ proofsByProductId: {} }));
    expect(noProofSummary.counts.confirmed).toBe(0);
    expect(noProofSummary.counts.meta_approved).toBe(9);

    // Dual catalogs: proofs for cat-a must not confirm on ch-b/cat-b.
    const otherChannel = scope({
      channelId: "ch-b",
      metaCatalogId: "cat-b",
      proofsByProductId
    });
    expect(summarizeCatalogVisibility(rows, otherChannel).counts.confirmed).toBe(0);

    const remaining = filterCatalogByVisibility(rows, "all", channelScope).filter(
      (item) => catalogWhatsAppVisibility(item, channelScope).status !== "confirmed"
    );
    expect(remaining).toHaveLength(21);
    expect(
      remaining.every((item) => {
        const status = catalogWhatsAppVisibility(item, channelScope).status;
        return ["local", "linked", "meta_approved", "broken", "unknown"].includes(status);
      })
    ).toBe(true);
    expect(
      remaining.every((item) => {
        const info = catalogWhatsAppVisibility(item, channelScope);
        return Boolean(info.reason && info.nextStep);
      })
    ).toBe(true);
  });
});
