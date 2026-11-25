import type { CatalogProduct, CatalogVisibilityProof } from "./catalogHelpers";

/** 32-product fixture: 30 active + 2 archived for UI acceptance previews. */
export function buildCatalogUiDemoProducts(): CatalogProduct[] {
  const orgA = "org-a";
  const orgB = "org-b";
  const channelA = "ch-a";
  const rows: CatalogProduct[] = [];

  const base = (overrides: Partial<CatalogProduct>): CatalogProduct => ({
    id: overrides.id ?? "p",
    organization_id: overrides.organization_id ?? orgA,
    channel_id: overrides.channel_id ?? channelA,
    name: overrides.name ?? "Product",
    sku: overrides.sku ?? null,
    product_type: overrides.product_type ?? "product",
    description: overrides.description ?? null,
    price: overrides.price ?? "10",
    currency: overrides.currency ?? "KWD",
    price_type: overrides.price_type ?? "fixed",
    specs_json: {},
    keywords: null,
    image_url: overrides.image_url ?? null,
    category: overrides.category ?? "عام",
    meta_retailer_id: overrides.meta_retailer_id ?? null,
    meta_item_group_id: null,
    variant_size: null,
    variant_color: null,
    variant_attributes: {},
    external_source: overrides.external_source ?? null,
    external_id: overrides.external_id ?? null,
    meta_sync_status: overrides.meta_sync_status ?? null,
    meta_review_status: overrides.meta_review_status ?? null,
    meta_synced_at: overrides.meta_synced_at ?? null,
    meta_sync_error: overrides.meta_sync_error ?? null,
    meta_review_detail: overrides.meta_review_detail ?? null,
    meta_sync_enabled: overrides.meta_sync_enabled ?? true,
    usage_count: overrides.usage_count ?? 0,
    is_active: overrides.is_active ?? true,
    sort_order: overrides.sort_order ?? 0
  });

  for (let i = 0; i < 5; i += 1) {
    rows.push(
      base({
        id: `confirmed-${i}`,
        name: i === 0 ? "Premium Wireless Headphones Series X Pro Max Edition" : `منتج مؤكد ${i + 1}`,
        sku: `CNF-${i + 1}`,
        price: String(12 + i),
        external_id: `meta-c-${i}`,
        meta_review_status: "approved",
        meta_sync_status: "synced",
        meta_synced_at: "2026-11-20T10:00:00Z",
        category: "إلكترونيات"
      })
    );
  }
  for (let i = 0; i < 5; i += 1) {
    rows.push(
      base({
        id: `approved-${i}`,
        name: `معتمد بلا تحقق ${i + 1}`,
        sku: `APR-${i + 1}`,
        price: String(20 + i),
        external_id: `meta-a-${i}`,
        meta_review_status: "approved",
        meta_sync_status: "synced",
        meta_synced_at: "2026-11-18T08:00:00Z",
        organization_id: i % 2 === 0 ? orgA : orgB
      })
    );
  }
  for (let i = 0; i < 6; i += 1) {
    rows.push(
      base({
        id: `linked-${i}`,
        name: `مربوط Meta ${i + 1}`,
        sku: `LNK-${i + 1}`,
        price: String(8 + i),
        external_id: `meta-l-${i}`,
        meta_review_status: "pending",
        meta_sync_status: "synced",
        meta_synced_at: "2026-11-19T12:00:00Z"
      })
    );
  }
  for (let i = 0; i < 6; i += 1) {
    rows.push(
      base({
        id: `local-${i}`,
        name: `منتج محلي ${i + 1}`,
        sku: `LOC-${i + 1}`,
        price: String(5 + i),
        meta_retailer_id: `ret-${i}`,
        category: "خدمات",
        product_type: i % 2 === 0 ? "product" : "service"
      })
    );
  }
  for (let i = 0; i < 4; i += 1) {
    rows.push(
      base({
        id: `broken-${i}`,
        name: i === 0 ? "Rejected Catalog Item Long English Name" : `منتج متعطل ${i + 1}`,
        sku: `BRK-${i + 1}`,
        price: String(15 + i),
        external_id: `meta-b-${i}`,
        meta_review_status: "rejected",
        meta_review_detail: "صورة غير مطابقة لمتطلبات Meta",
        meta_sync_status: "synced",
        meta_synced_at: "2026-11-17T09:30:00Z"
      })
    );
  }
  for (let i = 0; i < 4; i += 1) {
    rows.push(
      base({
        id: `unknown-${i}`,
        name: `مجهول الحالة ${i + 1}`,
        sku: `UNK-${i + 1}`,
        price: String(9 + i),
        external_id: `meta-u-${i}`,
        meta_sync_status: "failed",
        meta_sync_error: "timeout",
        meta_synced_at: "2026-11-16T14:00:00Z"
      })
    );
  }
  // 2 archived → summary 32, active tab 30
  rows.push(
    base({
      id: "archived-1",
      name: "منتج مؤرشف 1",
      sku: "ARC-1",
      price: "3",
      is_active: false,
      meta_review_status: "rejected",
      external_id: "meta-arc-1"
    }),
    base({
      id: "archived-2",
      name: "منتج مؤرشف 2",
      sku: "ARC-2",
      price: "4",
      is_active: false,
      meta_retailer_id: "ret-arc"
    })
  );

  return rows;
}

export function buildCatalogUiDemoProofs(): Record<string, CatalogVisibilityProof> {
  const proofs: Record<string, CatalogVisibilityProof> = {};
  for (let i = 0; i < 5; i += 1) {
    const id = `confirmed-${i}`;
    proofs[id] = {
      accountId: "wa-a",
      organizationId: "org-a",
      channelId: "ch-a",
      catalogId: "cat-a",
      productId: id,
      verifiedAt: "2026-11-24T11:00:00Z",
      source: "demo_fixture"
    };
  }
  return proofs;
}

export const CATALOG_UI_DEMO_ORGS = [
  { id: "org-a", name: "الفرع الرئيسي" },
  { id: "org-b", name: "فرع السالمية" }
];

export const CATALOG_UI_DEMO_CHANNELS = [
  {
    id: "wa-a",
    channel_id: "ch-a",
    organization_id: "org-a",
    verified_name: "Watesly Main",
    display_phone_number: "+965 5000 0001",
    channel_name: "Main",
    waba_id: "waba",
    phone_number_id: "phone",
    status: "CONNECTED",
    meta_catalog_id: "cat-a",
    commerce_enabled: true
  },
  {
    id: "wa-b",
    channel_id: "ch-b",
    organization_id: "org-a",
    verified_name: "Watesly Second",
    display_phone_number: "+965 5000 0002",
    channel_name: "Second",
    waba_id: "waba",
    phone_number_id: "phone2",
    status: "CONNECTED",
    meta_catalog_id: "cat-b",
    commerce_enabled: true
  }
];
