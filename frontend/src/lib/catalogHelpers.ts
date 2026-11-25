import { api } from "./api";

export type CatalogProduct = {
  id: string;
  organization_id: string | null;
  channel_id: string | null;
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
  channelId: string;
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
    channelId: "",
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
    channelId: product.channel_id ?? "",
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
    channel_id: form.channelId || null,
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
    channel_id: form.channelId || null,
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

export function simpleProductFormReady(form: ProductFormState, organizationsCount = 1, whatsappAccountsCount = 1) {
  const price = Number(form.price);
  const hasOrg = organizationsCount <= 1 || Boolean(form.organizationId.trim());
  const hasChannel = whatsappAccountsCount <= 1 || Boolean(form.channelId.trim());
  return (
    Boolean(form.name.trim()) &&
    Boolean(form.imageUrl.trim()) &&
    Number.isFinite(price) &&
    price > 0 &&
    hasOrg &&
    hasChannel
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
  const amount = Number(item.price);
  const currency = (item.currency || "KWD").trim() || "KWD";
  let formatted = item.price;
  if (Number.isFinite(amount)) {
    try {
      formatted = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 3
      }).format(amount);
    } catch {
      formatted = `${amount} ${currency}`;
    }
  } else {
    formatted = `${item.price} ${currency}`;
  }
  if (item.price_type === "from") return `من ${formatted}`;
  return formatted;
}

export type CatalogSortKey = "name" | "price" | "updated";

export function sortCatalogProductsBy(
  items: CatalogProduct[],
  sortKey: CatalogSortKey = "name"
) {
  return [...items].sort((left, right) => {
    if (sortKey === "price") {
      const leftPrice = left.price_type === "quote" || !left.price ? Number.POSITIVE_INFINITY : Number(left.price);
      const rightPrice = right.price_type === "quote" || !right.price ? Number.POSITIVE_INFINITY : Number(right.price);
      const leftValue = Number.isFinite(leftPrice) ? leftPrice : Number.POSITIVE_INFINITY;
      const rightValue = Number.isFinite(rightPrice) ? rightPrice : Number.POSITIVE_INFINITY;
      if (leftValue !== rightValue) return leftValue - rightValue;
      return left.name.localeCompare(right.name, "ar");
    }
    if (sortKey === "updated") {
      const leftAt = left.meta_synced_at || "";
      const rightAt = right.meta_synced_at || "";
      const byDate = rightAt.localeCompare(leftAt);
      if (byDate !== 0) return byDate;
      return left.name.localeCompare(right.name, "ar");
    }
    const byName = left.name.localeCompare(right.name, "ar");
    if (byName !== 0) return byName;
    return (left.sort_order ?? 0) - (right.sort_order ?? 0);
  });
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
      return {
        label: "مزامَن",
        className: "meta-synced",
        detail: "في Meta — اضغط «تحديث حالة Meta» للتأكد من الاعتماد قبل الظهور في WhatsApp"
      };
  }
}

/** WhatsApp customer-visibility buckets for a branch/channel catalog view. */
export type CatalogVisibilityStatus =
  | "local"
  | "linked"
  | "meta_approved"
  | "confirmed"
  | "broken"
  | "unknown";

/** Explicit proof that a product is visible on a specific WhatsApp number/catalog. */
export type CatalogVisibilityProof = {
  accountId: string;
  organizationId: string | null;
  channelId: string;
  catalogId: string;
  productId: string;
  verifiedAt: string;
  source: string;
};

/**
 * Channel-scoped context for visibility classification.
 * Without a selected channel + matching product proof, nothing is "confirmed".
 */
export type CatalogVisibilityScope = {
  channelId: string | null;
  organizationId: string | null;
  accountId: string | null;
  metaCatalogId: string | null;
  /** Phone-level catalog UI toggle (not per-product proof). */
  isCatalogVisible: boolean | null;
  catalogLinked: boolean | null;
  proofsByProductId: Record<string, CatalogVisibilityProof>;
};

export type CatalogVisibilityUpdateKind = "visibility_check" | "sync" | "none";

export type CatalogVisibilityInfo = {
  status: CatalogVisibilityStatus;
  label: string;
  reason: string;
  /** @deprecated Prefer lastSyncedAt / lastVisibilityCheckedAt */
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  lastVisibilityCheckedAt: string | null;
  lastUpdateKind: CatalogVisibilityUpdateKind;
  lastUpdateAt: string | null;
  lastUpdateLabel: string;
  nextStep: string;
  className: string;
};

const VISIBILITY_LABELS: Record<CatalogVisibilityStatus, string> = {
  local: "محلي",
  linked: "مربوط بـ Meta ID",
  meta_approved: "معتمد لدى Meta · الظهور غير متحقق",
  confirmed: "مؤكد الظهور",
  broken: "متعطل",
  unknown: "مجهول الحالة"
};

/** Short labels for dense table/cards; full labels stay in details/tooltips. */
export const VISIBILITY_SHORT_LABELS: Record<CatalogVisibilityStatus, string> = {
  local: "محلي",
  linked: "مربوط بـ Meta",
  meta_approved: "معتمد",
  confirmed: "مؤكد",
  broken: "متعطل",
  unknown: "مجهول"
};

export const VISIBILITY_CARD_ICONS: Record<CatalogVisibilityStatus, string> = {
  confirmed: "C",
  meta_approved: "A",
  linked: "L",
  local: "O",
  broken: "!",
  unknown: "?"
};

export function catalogVisibilityShortLabel(status: CatalogVisibilityStatus) {
  return VISIBILITY_SHORT_LABELS[status];
}

export function emptyCatalogVisibilityScope(
  overrides: Partial<CatalogVisibilityScope> = {}
): CatalogVisibilityScope {
  return {
    channelId: null,
    organizationId: null,
    accountId: null,
    metaCatalogId: null,
    isCatalogVisible: null,
    catalogLinked: null,
    proofsByProductId: {},
    ...overrides
  };
}

export function isMetaReviewApproved(review: string | null | undefined) {
  const value = (review || "").toLowerCase();
  return value === "approved" || value === "no_review";
}

export function productBelongsToSelectedChannel(
  product: Pick<CatalogProduct, "channel_id">,
  channelId: string | null | undefined
) {
  if (!channelId) return true;
  if (!product.channel_id) return true;
  return product.channel_id === channelId;
}

export function isValidCatalogVisibilityProof(
  proof: CatalogVisibilityProof | null | undefined,
  product: Pick<CatalogProduct, "id" | "channel_id" | "organization_id" | "is_active">,
  scope: CatalogVisibilityScope
): proof is CatalogVisibilityProof {
  if (!proof) return false;
  if (!scope.channelId?.trim() || !scope.metaCatalogId?.trim()) return false;
  if (!product.is_active) return false;
  if (proof.productId !== product.id) return false;
  if (proof.channelId !== scope.channelId) return false;
  if (proof.catalogId !== scope.metaCatalogId) return false;
  if (!proof.verifiedAt?.trim()) return false;
  if (product.channel_id && product.channel_id !== scope.channelId) return false;
  if (
    scope.organizationId &&
    proof.organizationId &&
    proof.organizationId !== scope.organizationId
  ) {
    return false;
  }
  if (
    product.organization_id &&
    proof.organizationId &&
    product.organization_id !== proof.organizationId
  ) {
    return false;
  }
  // Phone catalog UI off means customers cannot browse the catalog on this number.
  if (scope.isCatalogVisible === false) return false;
  return true;
}

function visibilityTimestamps(
  product: CatalogProduct,
  proof: CatalogVisibilityProof | null
): Pick<
  CatalogVisibilityInfo,
  | "lastCheckedAt"
  | "lastSyncedAt"
  | "lastVisibilityCheckedAt"
  | "lastUpdateKind"
  | "lastUpdateAt"
  | "lastUpdateLabel"
> {
  const lastSyncedAt = product.meta_synced_at ?? null;
  const lastVisibilityCheckedAt = proof?.verifiedAt ?? null;
  if (lastVisibilityCheckedAt) {
    return {
      lastCheckedAt: lastVisibilityCheckedAt,
      lastSyncedAt,
      lastVisibilityCheckedAt,
      lastUpdateKind: "visibility_check",
      lastUpdateAt: lastVisibilityCheckedAt,
      lastUpdateLabel: "آخر تحقق من الظهور"
    };
  }
  if (lastSyncedAt) {
    return {
      lastCheckedAt: lastSyncedAt,
      lastSyncedAt,
      lastVisibilityCheckedAt: null,
      lastUpdateKind: "sync",
      lastUpdateAt: lastSyncedAt,
      lastUpdateLabel: "آخر مزامنة"
    };
  }
  return {
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastVisibilityCheckedAt: null,
    lastUpdateKind: "none",
    lastUpdateAt: null,
    lastUpdateLabel: "—"
  };
}

function visibilityInfo(
  partial: Omit<
    CatalogVisibilityInfo,
    | "lastCheckedAt"
    | "lastSyncedAt"
    | "lastVisibilityCheckedAt"
    | "lastUpdateKind"
    | "lastUpdateAt"
    | "lastUpdateLabel"
  >,
  product: CatalogProduct,
  proof: CatalogVisibilityProof | null = null
): CatalogVisibilityInfo {
  return {
    ...partial,
    ...visibilityTimestamps(product, proof)
  };
}

/**
 * Classify WhatsApp customer visibility from stored fields + optional channel proof.
 *
 * Confirmed only with an explicit proof bound to company/branch/channel/catalog/product
 * for the selected WhatsApp number. Meta ID, approved/no_review, and sync timestamps
 * alone never yield «مؤكد الظهور». Read-only: no sync/mutation.
 */
export function catalogWhatsAppVisibility(
  product: CatalogProduct,
  scope: CatalogVisibilityScope | null = null
): CatalogVisibilityInfo {
  const effectiveScope = scope ?? emptyCatalogVisibilityScope();
  const hasMetaProductId = Boolean(product.external_id?.trim());
  const hasRetailerId = Boolean(product.meta_retailer_id?.trim());
  const review = (product.meta_review_status || "").toLowerCase();
  const channelSelected = Boolean(effectiveScope.channelId?.trim());
  const candidateProof = effectiveScope.proofsByProductId[product.id] ?? null;
  const proofValid = isValidCatalogVisibilityProof(candidateProof, product, effectiveScope);
  const proof = proofValid ? candidateProof : null;

  if (!product.is_active) {
    return visibilityInfo(
      {
        status: "broken",
        label: VISIBILITY_LABELS.broken,
        reason: "المنتج مؤرشف محلياً ولن يظهر للعميل على واتساب.",
        nextStep: "استرجع المنتج من الأرشيف إن أردت إعادة تقييم ظهوره.",
        className: "visibility-broken"
      },
      product,
      proof
    );
  }

  if (channelSelected && product.channel_id && product.channel_id !== effectiveScope.channelId) {
    return visibilityInfo(
      {
        status: "unknown",
        label: VISIBILITY_LABELS.unknown,
        reason: "هذا المنتج مرتبط برقم واتساب آخر في الفرع — لا يدخل في عداد الرقم المختار.",
        nextStep: "بدّل إلى رقم المنتج أو أعد تعيين القناة إن كان تابعاً لهذا الرقم.",
        className: "visibility-unknown"
      },
      product,
      null
    );
  }

  if (proof) {
    return visibilityInfo(
      {
        status: "confirmed",
        label: VISIBILITY_LABELS.confirmed,
        reason: `دليل ظهور على كتالوج الرقم المحدد (${effectiveScope.metaCatalogId}) من مصدر: ${proof.source}.`,
        nextStep: "راقِب الكتالوج على الرقم؛ لا حاجة لمزامنة تلقائية الآن.",
        className: "visibility-confirmed"
      },
      product,
      proof
    );
  }

  if (review === "rejected") {
    return visibilityInfo(
      {
        status: "broken",
        label: VISIBILITY_LABELS.broken,
        reason: product.meta_review_detail?.trim() || "Meta رفض المنتج — لا يظهر للعميل.",
        nextStep: "صحّح سبب الرفض في بيانات المنتج ثم أعد الإرسال يدوياً.",
        className: "visibility-broken"
      },
      product
    );
  }

  // Sync pause / failure do not prove a previously published copy disappeared.
  if (product.meta_sync_enabled === false) {
    return visibilityInfo(
      {
        status: "unknown",
        label: VISIBILITY_LABELS.unknown,
        reason: hasMetaProductId
          ? "المزامنة متوقفة — لا يكفي للجزم بأن نسخة منشورة سابقاً اختفت من واتساب."
          : "المزامنة متوقفة — المنتج لم يُرسل بعد ولن يُحدَّث على القناة.",
        nextStep: "فعّل المزامنة يدوياً عند الحاجة، أو تحقق من ظهور الكتالوج على الرقم مباشرة.",
        className: "visibility-unknown"
      },
      product
    );
  }

  if (product.meta_sync_status === "failed") {
    return visibilityInfo(
      {
        status: "unknown",
        label: VISIBILITY_LABELS.unknown,
        reason: product.meta_sync_error?.trim()
          ? `تعطلت المزامنة: ${product.meta_sync_error.trim()} — لا يجزم باختفاء نسخة منشورة.`
          : "تعطلت المزامنة — فشل التحديث لا يكفي للجزم باختفاء المنتج من الكتالوج.",
        nextStep: "راجع الخطأ ثم أعد المزامنة يدوياً لهذا المنتج فقط إن لزم.",
        className: "visibility-unknown"
      },
      product
    );
  }

  if (isMetaReviewApproved(review)) {
    const missingParts: string[] = [];
    if (!channelSelected) missingParts.push("اختيار رقم واتساب");
    else if (!effectiveScope.metaCatalogId?.trim()) missingParts.push("معرّف كتالوج الرقم");
    if (effectiveScope.isCatalogVisible === false) {
      missingParts.push("تفعيل إظهار الكتالوج على الرقم");
    }
    if (!candidateProof || !proofValid) {
      missingParts.push("دليل ظهور للمنتج على كتالوج هذا الرقم");
    }
    const missingText = missingParts.length
      ? ` ينقص: ${missingParts.join("، ")}.`
      : "";
    return visibilityInfo(
      {
        status: "meta_approved",
        label: VISIBILITY_LABELS.meta_approved,
        reason: channelSelected
          ? `معتمد لدى Meta، لكن الظهور على الرقم المختار غير متحقق.${missingText}`
          : "معتمد لدى Meta — اختر رقم واتساب لمعرفة إن كان ظاهراً على كتالوج هذا الرقم.",
        nextStep: channelSelected
          ? "اربط دليل ظهور المنتج بالقناة/الكتالوج أو افحص الكتالوج على الرقم يدوياً."
          : "اختر رقم واتساب من المحدد أعلاه لعرض حالة الظهور الخاصة به.",
        className: "visibility-meta-approved"
      },
      product
    );
  }

  if (hasMetaProductId) {
    if (review === "pending") {
      return visibilityInfo(
        {
          status: "linked",
          label: VISIBILITY_LABELS.linked,
          reason: "يوجد Meta ID والمنتج قيد المراجعة — المعرف والاعتماد المعلّق لا يؤكدان الظهور.",
          nextStep: "انتظر نتيجة المراجعة أو حدّث حالة Meta يدوياً عند الحاجة.",
          className: "visibility-linked"
        },
        product
      );
    }
    if (review === "outdated") {
      return visibilityInfo(
        {
          status: "unknown",
          label: VISIBILITY_LABELS.unknown,
          reason: "مرتبط بـ Meta لكن حالة المراجعة قديمة — الظهور غير مؤكد.",
          nextStep: "حدّث حالة Meta يدوياً لهذا المنتج للتحقق دون مزامنة جماعية.",
          className: "visibility-unknown"
        },
        product
      );
    }
    return visibilityInfo(
      {
        status: "linked",
        label: VISIBILITY_LABELS.linked,
        reason: "مرتبط بمعرّف Meta — هذا لا يكفي لتأكيد ظهوره على واتساب للعميل.",
        nextStep: "تحقق من الاعتماد ثم من دليل الظهور على رقم واتساب المحدد.",
        className: "visibility-linked"
      },
      product
    );
  }

  if (product.meta_sync_status === "synced") {
    return visibilityInfo(
      {
        status: "unknown",
        label: VISIBILITY_LABELS.unknown,
        reason: "سُجّلت مزامنة بدون Meta ID مؤكد وحالة مراجعة واضحة.",
        nextStep: "حدّث حالة Meta يدوياً لمعرفة أقصى ما يمكن إثباته.",
        className: "visibility-unknown"
      },
      product
    );
  }

  return visibilityInfo(
    {
      status: "local",
      label: VISIBILITY_LABELS.local,
      reason: hasRetailerId
        ? "منتج محلي مع Retailer ID جاهز — لم يُربط بعد بمعرّف Meta."
        : "منتج محلي فقط — غير مربوط بكتالوج واتساب/Meta.",
      nextStep: hasRetailerId
        ? "اربط القناة وCommerce ثم زامِن هذا المنتج يدوياً عند الحاجة."
        : "جهّز Meta IDs أو أنشئ الربط من صفحة واتساب عند الاستعداد.",
      className: "visibility-local"
    },
    product
  );
}

export function summarizeCatalogVisibility(
  products: CatalogProduct[],
  scope: CatalogVisibilityScope | null = null
) {
  const counts: Record<CatalogVisibilityStatus, number> = {
    local: 0,
    linked: 0,
    meta_approved: 0,
    confirmed: 0,
    broken: 0,
    unknown: 0
  };
  for (const product of products) {
    counts[catalogWhatsAppVisibility(product, scope).status] += 1;
  }
  const channelSelected = Boolean(scope?.channelId?.trim());
  return {
    total: products.length,
    counts,
    channelSelected,
    requiresChannelSelection: !channelSelected,
    cards: (
      [
        ["confirmed", VISIBILITY_SHORT_LABELS.confirmed],
        ["meta_approved", VISIBILITY_SHORT_LABELS.meta_approved],
        ["linked", VISIBILITY_SHORT_LABELS.linked],
        ["local", VISIBILITY_SHORT_LABELS.local],
        ["broken", VISIBILITY_SHORT_LABELS.broken],
        ["unknown", VISIBILITY_SHORT_LABELS.unknown]
      ] as Array<[CatalogVisibilityStatus, string]>
    ).map(([status, label]) => {
      const needsChannel = status === "confirmed" && !channelSelected;
      return {
        status,
        label,
        fullLabel: VISIBILITY_LABELS[status],
        count: counts[status],
        /** null → show em dash until a WhatsApp number is selected. */
        displayCount: needsChannel ? null : counts[status],
        needsChannelSelection: needsChannel,
        icon: VISIBILITY_CARD_ICONS[status],
        hint:
          status === "confirmed"
            ? channelSelected
              ? "دليل ظهور على الرقم/الكتالوج"
              : "يتطلب اختيار رقم واتساب لتأكيد الظهور"
            : status === "meta_approved"
              ? "اعتماد Meta بلا تحقق ظهور"
              : status === "linked"
                ? "Meta ID لا يكفي وحده"
                : status === "local"
                  ? "لم يُربط بعد"
                  : status === "broken"
                    ? "مؤرشف أو مرفوض"
                    : "تعطل مزامنة أو نقص دليل"
      };
    })
  };
}

export function filterCatalogByVisibility(
  products: CatalogProduct[],
  status: CatalogVisibilityStatus | "all",
  scope: CatalogVisibilityScope | null = null
) {
  if (status === "all") return products;
  return products.filter((item) => catalogWhatsAppVisibility(item, scope).status === status);
}

export function filterCatalogBySearch<T extends Pick<CatalogProduct, "name" | "sku" | "keywords" | "description">>(
  items: T[],
  query: string
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack = [item.name, item.sku, item.keywords, item.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
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
  name: string;
  sku: string;
  metaRetailerId: string;
  variantSize: string;
  variantColor: string;
  variantAttributes: Record<string, string>;
  price: string;
  imageUrl: string;
  sortOrder: string;
};

export const OFFER_VARIANT_ATTR_KEY = "الباقة";

export type OfferVariantFormState = {
  clientKey: string;
  id: string;
  offerLabel: string;
  price: string;
  imageUrl: string;
  sku: string;
  sortOrder: string;
};

export type OfferGroupFormState = {
  metaItemGroupId: string;
  baseName: string;
  organizationId: string;
  channelId: string;
  category: string;
  description: string;
  currency: string;
  priceType: "fixed" | "from" | "quote";
  metaSyncEnabled: boolean;
  variants: OfferVariantFormState[];
};

export type MetaGroupFormState = {
  metaItemGroupId: string;
  baseName: string;
  organizationId: string;
  channelId: string;
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
  channel_id: string | null;
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
    name: "",
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

export function emptyOfferVariant(index = 0): OfferVariantFormState {
  return {
    clientKey: newMetaVariantKey(),
    id: "",
    offerLabel: "",
    price: "",
    imageUrl: "",
    sku: "",
    sortOrder: String(index)
  };
}

export function emptyOfferGroupForm(): OfferGroupFormState {
  return {
    metaItemGroupId: "",
    baseName: "",
    organizationId: "",
    channelId: "",
    category: "عروض",
    description: "",
    currency: "KWD",
    priceType: "fixed",
    metaSyncEnabled: true,
    variants: [emptyOfferVariant(0)]
  };
}

export function emptyMetaGroupForm(): MetaGroupFormState {
  return {
    metaItemGroupId: "",
    baseName: "",
    organizationId: "",
    channelId: "",
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
    channelId: group.channel_id ?? "",
    category: group.category ?? "",
    description: group.description ?? "",
    productType: group.product_type === "service" ? "service" : "product",
    currency: group.currency || "KWD",
    priceType: (group.price_type as MetaGroupFormState["priceType"]) || "fixed",
    metaSyncEnabled: group.meta_sync_enabled !== false,
    variants: group.variants.map((variant, index) => ({
      clientKey: newMetaVariantKey(),
      id: variant.id,
      name: variant.name ?? "",
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

function offerLabelFromVariant(
  baseName: string,
  variant: MetaGroupResponse["variants"][number]
): string {
  const fromAttributes = variant.variant_attributes?.[OFFER_VARIANT_ATTR_KEY]?.trim();
  if (fromAttributes) return fromAttributes;
  const prefix = `${baseName.trim()} — `;
  if (variant.name?.startsWith(prefix)) {
    return variant.name.slice(prefix.length).trim();
  }
  return variant.name?.trim() ?? "";
}

export function offerGroupFormFromResponse(group: MetaGroupResponse): OfferGroupFormState {
  return {
    metaItemGroupId: group.meta_item_group_id,
    baseName: group.base_name,
    organizationId: group.organization_id ?? "",
    channelId: group.channel_id ?? "",
    category: group.category ?? "عروض",
    description: group.description ?? "",
    currency: group.currency || "KWD",
    priceType: (group.price_type as OfferGroupFormState["priceType"]) || "fixed",
    metaSyncEnabled: group.meta_sync_enabled !== false,
    variants: group.variants.map((variant, index) => ({
      clientKey: newMetaVariantKey(),
      id: variant.id,
      offerLabel: offerLabelFromVariant(group.base_name, variant),
      price: variant.price ?? "",
      imageUrl: variant.image_url ?? "",
      sku: variant.sku ?? "",
      sortOrder: String(variant.sort_order ?? index)
    }))
  };
}

export function isOfferMetaGroup(group: MetaGroupResponse): boolean {
  const category = group.category?.trim() ?? "";
  if (/عرض/i.test(category)) return true;
  if (!group.variants.length) return false;
  return group.variants.every(
    (variant) =>
      !variant.variant_size?.trim() &&
      !variant.variant_color?.trim() &&
      Boolean(
        variant.variant_attributes?.[OFFER_VARIANT_ATTR_KEY]?.trim() ||
          offerLabelFromVariant(group.base_name, variant)
      )
  );
}

export function buildMetaGroupPayload(form: MetaGroupFormState) {
  return {
    meta_item_group_id: form.metaItemGroupId.trim(),
    base_name: form.baseName.trim(),
    organization_id: form.organizationId || null,
    channel_id: form.channelId || null,
    category: form.category.trim() || null,
    description: form.description.trim() || null,
    product_type: form.productType,
    currency: form.currency.trim() || "KWD",
    price_type: form.priceType,
    meta_sync_enabled: form.metaSyncEnabled,
    variants: form.variants.map((variant, index) => ({
      ...(variant.id ? { id: variant.id } : {}),
      ...(variant.name.trim() ? { name: variant.name.trim() } : {}),
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

export function buildOfferGroupPayload(form: OfferGroupFormState) {
  const baseName = form.baseName.trim();
  return {
    meta_item_group_id: form.metaItemGroupId.trim(),
    base_name: baseName,
    organization_id: form.organizationId || null,
    channel_id: form.channelId || null,
    category: form.category.trim() || "عروض",
    description: form.description.trim() || null,
    product_type: "product" as const,
    currency: form.currency.trim() || "KWD",
    price_type: form.priceType,
    meta_sync_enabled: form.metaSyncEnabled,
    variants: form.variants.map((variant, index) => {
      const offerLabel = variant.offerLabel.trim();
      const variantName = offerLabel ? `${baseName} — ${offerLabel}`.slice(0, 200) : null;
      return {
        ...(variant.id ? { id: variant.id } : {}),
        ...(variantName ? { name: variantName } : {}),
        sku: variant.sku.trim() || null,
        meta_retailer_id: variant.sku.trim() || null,
        variant_size: null,
        variant_color: null,
        variant_attributes: offerLabel ? { [OFFER_VARIANT_ATTR_KEY]: offerLabel } : {},
        price: form.priceType === "quote" ? null : variant.price.trim() ? Number(variant.price) : null,
        image_url: variant.imageUrl.trim() || null,
        sort_order: Number(variant.sortOrder) || index
      };
    })
  };
}

export function offerGroupReady(form: OfferGroupFormState, whatsappAccountsCount = 1) {
  if (!form.baseName.trim() || !form.metaItemGroupId.trim()) return false;
  if (whatsappAccountsCount > 1 && !form.channelId.trim()) return false;
  if (!form.variants.length) return false;
  return form.variants.every((variant) => {
    if (!variant.offerLabel.trim() || !variant.imageUrl.trim()) return false;
    if (form.priceType === "quote") return true;
    const price = Number(variant.price);
    return Number.isFinite(price) && price > 0;
  });
}

export function metaGroupReady(form: MetaGroupFormState, whatsappAccountsCount = 1) {
  if (!form.baseName.trim() || !form.metaItemGroupId.trim()) return false;
  if (whatsappAccountsCount > 1 && !form.channelId.trim()) return false;
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
