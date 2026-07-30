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
  external_source: string | null;
  external_id: string | null;
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
    sort_order: Number(form.sortOrder) || 0
  };
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
