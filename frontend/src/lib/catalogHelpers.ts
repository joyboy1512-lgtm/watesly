import { api } from "./api";

export type CatalogProduct = {
  id: string;
  organization_id: string | null;
  name: string;
  sku: string | null;
  product_type: string;
  description: string | null;
  price: string | null;
  currency: string;
  price_type: string;
  specs_json: Record<string, string>;
  keywords: string | null;
  image_url: string | null;
  category: string | null;
  meta_retailer_id: string | null;
  meta_item_group_id: string | null;
  variant_size: string | null;
  variant_color: string | null;
  variant_attributes: Record<string, string>;
  external_source: string | null;
  external_id: string | null;
  meta_sync_status: string | null;
  meta_review_status: string | null;
  meta_synced_at: string | null;
  meta_sync_error: string | null;
  meta_review_detail: string | null;
  meta_sync_enabled: boolean;
  usage_count: number;
  is_active: boolean;
  sort_order: number;
};

export type MatchedCatalogProduct = {
  id: string;
  name: string;
  price_label: string;
  image_url?: string | null;
  description?: string | null;
  specs_preview?: string | null;
  product_type?: string;
};

export type CatalogReplyPreview = {
  suggestion: string;
  matched_products: MatchedCatalogProduct[];
  source?: string;
};

export type CatalogListTab = "active" | "inactive";
export type CatalogTypeFilter = "all" | "product" | "service";

export type ProductFormState = {
  organizationId: string;
  name: string;
  sku: string;
  productType: "product" | "service";
  description: string;
  price: string;
  priceType: "fixed" | "from" | "quote";
  currency: string;
  keywords: string;
  sortOrder: string;
  imageUrl: string;
  category: string;
  metaRetailerId: string;
  metaItemGroupId: string;
  variantSize: string;
  variantColor: string;
  variantAttributes: Record<string, string>;
  metaSyncEnabled: boolean;
  specs: Record<string, string>;
};

export function emptyProductForm(): ProductFormState {
  return {
    organizationId: "",
    name: "",
    sku: "",
    productType: "product",
    description: "",
    price: "",
    priceType: "fixed",
    currency: "KWD",
    keywords: "",
    sortOrder: "0",
    imageUrl: "",
    category: "",
    metaRetailerId: "",
    metaItemGroupId: "",
    variantSize: "",
    variantColor: "",
    variantAttributes: {},
    metaSyncEnabled: true,
    specs: {}
  };
}

export function productFormFromCatalog(product: CatalogProduct): ProductFormState {
  return {
    organizationId: product.organization_id ?? "",
    name: product.name,
    sku: product.sku ?? "",
    productType: product.product_type === "service" ? "service" : "product",
    description: product.description ?? "",
    price: product.price ?? "",
    priceType: (product.price_type as ProductFormState["priceType"]) || "fixed",
    currency: product.currency || "KWD",
    keywords: product.keywords ?? "",
    sortOrder: String(product.sort_order ?? 0),
    imageUrl: product.image_url ?? "",
    category: product.category ?? "",
    metaRetailerId: product.meta_retailer_id ?? "",
    metaItemGroupId: product.meta_item_group_id ?? "",
    variantSize: product.variant_size ?? "",
    variantColor: product.variant_color ?? "",
    variantAttributes: { ...(product.variant_attributes ?? {}) },
    metaSyncEnabled: product.meta_sync_enabled !== false,
    specs: { ...(product.specs_json ?? {}) }
  };
}

export function buildProductPayload(form: ProductFormState) {
  return {
    organization_id: form.organizationId || null,
    name: form.name.trim(),
    sku: form.sku.trim() || null,
    product_type: form.productType,
    description: form.description.trim() || null,
    price: form.priceType === "quote" ? null : Number(form.price),
    currency: form.currency.trim() || "KWD",
    price_type: form.priceType,
    specs_json: form.specs,
    keywords: form.keywords.trim() || null,
    image_url: form.imageUrl.trim() || null,
    category: form.category.trim() || null,
    meta_retailer_id: form.metaRetailerId.trim() || null,
    meta_item_group_id: form.metaItemGroupId.trim() || null,
    variant_size: form.variantSize.trim() || null,
    variant_color: form.variantColor.trim() || null,
    variant_attributes: form.variantAttributes,
    meta_sync_enabled: form.metaSyncEnabled,
    sort_order: Number(form.sortOrder) || 0
  };
}

export function buildSimpleProductPayload(form: ProductFormState) {
  const price = Number(form.price);
  return {
    organization_id: form.organizationId || null,
    name: form.name.trim(),
    sku: form.sku.trim() || null,
    product_type: "product" as const,
    description: form.description.trim() || form.name.trim(),
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: form.currency.trim() || "KWD",
    price_type: "fixed" as const,
    specs_json: {},
    keywords: null,
    image_url: form.imageUrl.trim() || null,
    category: null,
    meta_retailer_id: form.sku.trim() || null,
    meta_item_group_id: null,
    variant_size: null,
    variant_color: null,
    variant_attributes: {},
    meta_sync_enabled: form.metaSyncEnabled,
    sort_order: 0
  };
}

export function simpleProductFormReady(form: ProductFormState) {
  const price = Number(form.price);
  return (
    Boolean(form.name.trim()) &&
    Boolean(form.imageUrl.trim()) &&
    Number.isFinite(price) &&
    price > 0
  );
}

export function sortCatalogProducts(items: CatalogProduct[]) {
  return [...items].sort((left, right) => {
    const orderDiff = (left.sort_order ?? 0) - (right.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return left.name.localeCompare(right.name, "ar");
  });
}

export function catalogPriceLabel(item: Pick<CatalogProduct, "price_type" | "price" | "currency">) {
  if (item.price_type === "quote" || !item.price) return "عرض سعر";
  if (item.price_type === "from") return `من ${item.price} ${item.currency}`;
  return `${item.price} ${item.currency}`;
}

export function catalogTypeLabel(productType: string) {
  return productType === "service" ? "خدمة" : "منتج";
}

export function formatCatalogVariantLabel(
  product: Pick<
    CatalogProduct,
    "meta_item_group_id" | "variant_size" | "variant_color" | "variant_attributes"
  >
) {
  const parts: string[] = [];
  if (product.variant_color?.trim()) parts.push(product.variant_color.trim());
  if (product.variant_size?.trim()) parts.push(product.variant_size.trim());
  for (const [key, value] of Object.entries(product.variant_attributes ?? {})) {
    if (key.trim() && value.trim()) parts.push(`${key.trim()}: ${value.trim()}`);
  }
  if (!parts.length && product.meta_item_group_id?.trim()) {
    return product.meta_item_group_id.trim();
  }
  return parts.length ? parts.join(" · ") : "";
}

export type CatalogMetaStatusView = {
  label: string;
  className: string;
  detail?: string | null;
};

export function catalogMetaAutoSyncMessage(product: CatalogProduct): string | null {
  if (product.meta_sync_enabled === false) {
    return null;
  }
  if (product.meta_sync_status === "failed") {
    return product.meta_sync_error ?? "تعذر إرسال المنتج إلى Meta.";
  }
  if (product.meta_sync_status !== "synced" && !product.external_id) {
    return "تم الحفظ محلياً. فعّل Commerce وCatalog ID من ربط WhatsApp للمزامنة التلقائية.";
  }
  switch (product.meta_review_status) {
    case "pending":
      return "تم إرسال المنتج إلى Meta — قيد المراجعة.";
    case "approved":
    case "no_review":
      return "تم إرسال المنتج إلى Meta — معتمد.";
    case "rejected":
      return product.meta_review_detail
        ? `Meta رفض المنتج: ${product.meta_review_detail}`
        : "Meta رفض المنتج.";
    default:
      return product.external_id ? "تم إرسال المنتج إلى Meta." : null;
  }
}

export function catalogMetaStatusLabel(product: CatalogProduct): CatalogMetaStatusView {
  if (product.meta_sync_enabled === false) {
    return {
      label: "المزامنة متوقفة",
      className: "meta-paused",
      detail: product.external_id ? "مخفي من كتالوج Meta" : "لن يُرسل إلى Meta"
    };
  }

  if (product.meta_sync_status === "failed") {
    return {
      label: "فشل المزامنة",
      className: "meta-failed",
      detail: product.meta_sync_error
    };
  }

  const syncedToMeta =
    product.meta_sync_status === "synced" ||
    (product.external_source === "meta" && Boolean(product.external_id));

  if (!syncedToMeta) {
    return { label: "لم تُزامَن", className: "meta-not-synced" };
  }

  switch (product.meta_review_status) {
    case "pending":
      return {
        label: "قيد المراجعة",
        className: "meta-pending",
        detail: product.meta_review_detail
      };
    case "approved":
      return { label: "معتمد", className: "meta-approved" };
    case "rejected":
      return {
        label: "مرفوض",
        className: "meta-rejected",
        detail: product.meta_review_detail
      };
    case "outdated":
      return {
        label: "يحتاج تحديث",
        className: "meta-outdated",
        detail: product.meta_review_detail
      };
    case "no_review":
      return { label: "متاح", className: "meta-approved" };
    default:
      return { label: "مزامَن", className: "meta-synced" };
  }
}

export function formatSpecsPreview(specs: Record<string, string> | null | undefined) {
  const entries = Object.entries(specs ?? {});
  if (!entries.length) return "—";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" · ");
}

export function filterCatalogByType<T extends Pick<CatalogProduct, "product_type">>(
  items: T[],
  typeFilter: CatalogTypeFilter
) {
  if (typeFilter === "all") return items;
  return items.filter((item) => item.product_type === typeFilter);
}

export function formatProductWhatsAppLine(product: Pick<MatchedCatalogProduct, "name" | "price_label" | "description" | "specs_preview">) {
  let line = `• *${product.name}* — ${product.price_label}`;
  if (product.specs_preview) line += `\n  ${product.specs_preview}`;
  if (product.description) line += `\n  ${product.description.slice(0, 120)}`;
  return line;
}

export type CatalogExportOptions = {
  includeInactive?: boolean;
  format?: "xlsx" | "csv";
};

export async function downloadCatalogExport(options: CatalogExportOptions = {}) {
  const { includeInactive = false, format = "xlsx" } = options;
  const response = await api.get("/catalog/export", {
    params: {
      format,
      ...(includeInactive ? { include_inactive: true } : {})
    },
    responseType: "blob"
  });
  const mime =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv;charset=utf-8";
  const url = URL.createObjectURL(new Blob([response.data], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `catalog-export.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type MetaVariantFormState = {
  clientKey: string;
  id: string;
  sku: string;
  metaRetailerId: string;
  variantSize: string;
  variantColor: string;
  variantAttributes: Record<string, string>;
  price: string;
  imageUrl: string;
  sortOrder: string;
};

export type MetaGroupFormState = {
  metaItemGroupId: string;
  baseName: string;
  organizationId: string;
  category: string;
  description: string;
  productType: "product" | "service";
  currency: string;
  priceType: "fixed" | "from" | "quote";
  metaSyncEnabled: boolean;
  variants: MetaVariantFormState[];
};

export type MetaGroupResponse = {
  meta_item_group_id: string;
  base_name: string;
  organization_id: string | null;
  category: string | null;
  description: string | null;
  product_type: string;
  currency: string;
  price_type: string;
  meta_sync_enabled: boolean;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    meta_retailer_id: string | null;
    variant_size: string | null;
    variant_color: string | null;
    variant_attributes: Record<string, string>;
    price: string | null;
    image_url: string | null;
    sort_order: number;
    meta_sync_status: string | null;
    meta_review_status: string | null;
  }>;
};

let metaVariantKeyCounter = 0;

export function newMetaVariantKey() {
  metaVariantKeyCounter += 1;
  return `variant-${metaVariantKeyCounter}`;
}

export function emptyMetaVariant(index = 0): MetaVariantFormState {
  return {
    clientKey: newMetaVariantKey(),
    id: "",
    sku: "",
    metaRetailerId: "",
    variantSize: "",
    variantColor: "",
    variantAttributes: {},
    price: "",
    imageUrl: "",
    sortOrder: String(index)
  };
}

export function emptyMetaGroupForm(): MetaGroupFormState {
  return {
    metaItemGroupId: "",
    baseName: "",
    organizationId: "",
    category: "",
    description: "",
    productType: "product",
    currency: "KWD",
    priceType: "fixed",
    metaSyncEnabled: true,
    variants: [emptyMetaVariant(0)]
  };
}

export function slugifyMetaGroupId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function metaGroupFormFromResponse(group: MetaGroupResponse): MetaGroupFormState {
  return {
    metaItemGroupId: group.meta_item_group_id,
    baseName: group.base_name,
    organizationId: group.organization_id ?? "",
    category: group.category ?? "",
    description: group.description ?? "",
    productType: group.product_type === "service" ? "service" : "product",
    currency: group.currency || "KWD",
    priceType: (group.price_type as MetaGroupFormState["priceType"]) || "fixed",
    metaSyncEnabled: group.meta_sync_enabled !== false,
    variants: group.variants.map((variant, index) => ({
      clientKey: newMetaVariantKey(),
      id: variant.id,
      sku: variant.sku ?? "",
      metaRetailerId: variant.meta_retailer_id ?? "",
      variantSize: variant.variant_size ?? "",
      variantColor: variant.variant_color ?? "",
      variantAttributes: { ...(variant.variant_attributes ?? {}) },
      price: variant.price ?? "",
      imageUrl: variant.image_url ?? "",
      sortOrder: String(variant.sort_order ?? index)
    }))
  };
}

export function buildMetaGroupPayload(form: MetaGroupFormState) {
  return {
    meta_item_group_id: form.metaItemGroupId.trim(),
    base_name: form.baseName.trim(),
    organization_id: form.organizationId || null,
    category: form.category.trim() || null,
    description: form.description.trim() || null,
    product_type: form.productType,
    currency: form.currency.trim() || "KWD",
    price_type: form.priceType,
    meta_sync_enabled: form.metaSyncEnabled,
    variants: form.variants.map((variant, index) => ({
      ...(variant.id ? { id: variant.id } : {}),
      sku: variant.sku.trim() || null,
      meta_retailer_id: variant.metaRetailerId.trim() || null,
      variant_size: variant.variantSize.trim() || null,
      variant_color: variant.variantColor.trim() || null,
      variant_attributes: variant.variantAttributes,
      price: form.priceType === "quote" ? null : variant.price.trim() ? Number(variant.price) : null,
      image_url: variant.imageUrl.trim() || null,
      sort_order: Number(variant.sortOrder) || index
    }))
  };
}

export function metaGroupReady(form: MetaGroupFormState) {
  if (!form.baseName.trim() || !form.metaItemGroupId.trim()) return false;
  if (!form.variants.length) return false;
  if (form.priceType !== "quote") {
    return form.variants.every((variant) => variant.price.trim());
  }
  return true;
}

export function metaGroupSyncMessages(group: MetaGroupResponse): string[] {
  const messages: string[] = [];
  for (const variant of group.variants) {
    const product = {
      meta_sync_enabled: group.meta_sync_enabled,
      meta_sync_status: variant.meta_sync_status,
      meta_review_status: variant.meta_review_status,
      meta_sync_error: null,
      meta_review_detail: null,
      external_id: variant.meta_sync_status === "synced" ? "1" : null
    } as CatalogProduct;
    const message = catalogMetaAutoSyncMessage(product);
    if (message && !messages.includes(message)) {
      messages.push(message);
    }
  }
  return messages;
}
