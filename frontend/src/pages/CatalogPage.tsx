import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CatalogSimpleProductForm from "../components/CatalogSimpleProductForm";
import Icon from "../components/Icon";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import {
  buildProductPayload,
  buildSimpleProductPayload,
  catalogMetaAutoSyncMessage,
  catalogMetaStatusLabel,
  catalogPriceLabel,
  catalogTypeLabel,
  catalogWhatsAppVisibility,
  downloadCatalogExport,
  emptyCatalogVisibilityScope,
  emptyProductForm,
  filterCatalogBySearch,
  filterCatalogByType,
  filterCatalogByVisibility,
  formatCatalogVariantLabel,
  productFormFromCatalog,
  simpleProductFormReady,
  sortCatalogProducts,
  summarizeCatalogVisibility,
  type CatalogListTab,
  type CatalogProduct,
  type CatalogReplyPreview,
  type CatalogTypeFilter,
  type CatalogVisibilityScope,
  type CatalogVisibilityStatus,
  type ProductFormState
} from "../lib/catalogHelpers";
import { formatAppDateTime } from "../lib/language";
import { uploadFile } from "../lib/uploads";
import { type WhatsAppAccountRow } from "../lib/whatsappHelpers";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };

type CommerceReadinessLite = {
  meta_catalog_id?: string | null;
  catalog_linked?: boolean | null;
  is_catalog_visible?: boolean | null;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 0] as const;
const DEFAULT_PAGE_SIZE = 50;

export default function CatalogPage() {
  const client = useQueryClient();
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const savedListScrollRef = useRef(0);

  const [listTab, setListTab] = useState<CatalogListTab>("active");
  const [typeFilter, setTypeFilter] = useState<CatalogTypeFilter>("all");
  const [filterOrganizationId, setFilterOrganizationId] = useState("");
  const [filterChannelId, setFilterChannelId] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<CatalogVisibilityStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);

  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [editForm, setEditForm] = useState<ProductFormState>(emptyProductForm);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [refreshingMetaStatus, setRefreshingMetaStatus] = useState(false);
  const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewContactName, setPreviewContactName] = useState("");

  const previewReply = useQuery({
    queryKey: ["catalog-preview", previewQuery, previewContactName],
    enabled: previewQuery.trim().length > 0,
    queryFn: async () => (
      await api.post<CatalogReplyPreview>("/catalog/preview-reply", {
        query: previewQuery.trim(),
        contact_name: previewContactName.trim()
      })
    ).data
  });

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const categories = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => (await api.get<string[]>("/catalog/categories")).data
  });

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });

  const selectedWhatsApp = useMemo(
    () => (whatsappAccounts.data ?? []).find((account) => account.channel_id === filterChannelId) ?? null,
    [whatsappAccounts.data, filterChannelId]
  );

  const commerceReadiness = useQuery({
    queryKey: ["catalog-commerce-readiness", selectedWhatsApp?.id],
    enabled: Boolean(selectedWhatsApp?.id),
    queryFn: async () =>
      (await api.get<CommerceReadinessLite>(`/whatsapp/accounts/${selectedWhatsApp!.id}/commerce/readiness`)).data,
    staleTime: 60_000
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [listTab, typeFilter, filterOrganizationId, filterChannelId, filterCategory, visibilityFilter, debouncedSearch, pageSize]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!toolsMenuRef.current?.contains(event.target as Node)) {
        setShowToolsMenu(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations.data ?? []) {
      map.set(org.id, org.name);
    }
    return map;
  }, [organizations.data]);

  const channelOptions = useMemo(() => {
    const accounts = whatsappAccounts.data ?? [];
    const scoped = filterOrganizationId
      ? accounts.filter((account) => account.organization_id === filterOrganizationId)
      : accounts;
    return scoped.map((account) => ({
      id: account.channel_id,
      label: account.verified_name || account.display_phone_number || account.channel_name || "WhatsApp",
      phone: account.display_phone_number,
      metaCatalogId: account.meta_catalog_id ?? null,
      accountId: account.id,
      organizationId: account.organization_id
    }));
  }, [whatsappAccounts.data, filterOrganizationId]);

  // Load the full filtered catalog (not search-capped at 500) so counters match all rows.
  const products = useQuery({
    queryKey: ["catalog", filterOrganizationId, filterChannelId, filterCategory] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("include_inactive", "true");
      if (filterOrganizationId) params.set("organization_id", filterOrganizationId);
      if (filterChannelId) params.set("channel_id", filterChannelId);
      if (filterCategory) params.set("category", filterCategory);
      const result = await api.get<CatalogProduct[]>(`/catalog?${params.toString()}`);
      return result.data;
    }
  });

  /**
   * Integration gap: there is currently no persisted per-product membership proof
   * for a WhatsApp number/catalog. Until such a source exists, proofs stay empty
   * and «مؤكد الظهور» remains 0 in production data.
   */
  const visibilityScope: CatalogVisibilityScope = useMemo(() => {
    if (!filterChannelId || !selectedWhatsApp) {
      return emptyCatalogVisibilityScope();
    }
    const readiness = commerceReadiness.data;
    return emptyCatalogVisibilityScope({
      channelId: filterChannelId,
      organizationId: selectedWhatsApp.organization_id,
      accountId: selectedWhatsApp.id,
      metaCatalogId: readiness?.meta_catalog_id?.trim() || selectedWhatsApp.meta_catalog_id || null,
      isCatalogVisible: readiness?.is_catalog_visible ?? null,
      catalogLinked: readiness?.catalog_linked ?? null,
      proofsByProductId: {}
    });
  }, [filterChannelId, selectedWhatsApp, commerceReadiness.data]);

  const scopedProducts = useMemo(() => {
    const rows = products.data ?? [];
    const typed = filterCatalogByType(rows, typeFilter);
    const searched = filterCatalogBySearch(typed, debouncedSearch);
    return sortCatalogProducts(searched);
  }, [products.data, typeFilter, debouncedSearch]);

  const visibilitySummary = useMemo(
    () => summarizeCatalogVisibility(scopedProducts, visibilityScope),
    [scopedProducts, visibilityScope]
  );

  const visibleProducts = useMemo(() => {
    if (visibilityFilter !== "all") {
      return filterCatalogByVisibility(scopedProducts, visibilityFilter, visibilityScope);
    }
    return listTab === "inactive"
      ? scopedProducts.filter((item) => !item.is_active)
      : scopedProducts.filter((item) => item.is_active);
  }, [scopedProducts, listTab, visibilityFilter, visibilityScope]);

  const total = visibleProducts.length;
  const effectivePageSize = pageSize === 0 ? total || 1 : pageSize;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / effectivePageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const pageEnd = pageSize === 0 ? total : Math.min(safePage * effectivePageSize, total);
  const pageRows =
    pageSize === 0
      ? visibleProducts
      : visibleProducts.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  const pageIds = pageRows.map((item) => item.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const detailProduct = useMemo(
    () => scopedProducts.find((item) => item.id === detailProductId) ?? null,
    [scopedProducts, detailProductId]
  );

  const activeVisibilityCard = visibilitySummary.cards.find((card) => card.status === visibilityFilter);
  const resultsTitle =
    visibilityFilter !== "all" && activeVisibilityCard
      ? `${activeVisibilityCard.label} · ${total.toLocaleString("ar")} منتج`
      : listTab === "inactive"
        ? `المؤرشفة · ${total.toLocaleString("ar")} منتج`
        : `المنتجات النشطة · ${total.toLocaleString("ar")} منتج`;

  function toggleRowSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openDetail(product: CatalogProduct) {
    if (listScrollRef.current) {
      savedListScrollRef.current = listScrollRef.current.scrollTop;
    }
    setDetailProductId(product.id);
  }

  function closeDetail() {
    setDetailProductId(null);
    window.requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = savedListScrollRef.current;
      }
    });
  }

  function openEdit(product: CatalogProduct) {
    setEditingProduct(product);
    setEditForm(productFormFromCatalog(product));
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingProduct) return;
    if (!editingProduct.meta_item_group_id?.trim() && !simpleProductFormReady(editForm, organizations.data?.length ?? 1, whatsappAccounts.data?.length ?? 1)) {
      toastStore.getState().show("أكمل: القناة، الاسم، السعر، والصورة.", "error");
      return;
    }
    try {
      const payload = editingProduct.meta_item_group_id?.trim()
        ? buildProductPayload(editForm)
        : buildSimpleProductPayload(editForm);
      const response = await api.patch<CatalogProduct>(`/catalog/${editingProduct.id}`, payload);
      setEditingProduct(null);
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      toastStore.getState().show("تم تحديث المنتج.", "success");
      const metaMessage = catalogMetaAutoSyncMessage(response.data);
      if (metaMessage) {
        toastStore.getState().show(
          metaMessage,
          response.data.meta_review_status === "rejected" || response.data.meta_sync_status === "failed"
            ? "error"
            : "success"
        );
      }
    } catch {
      toastStore.getState().show("تعذر التحديث.", "error");
    }
  }

  async function deactivateProduct(id: string) {
    await api.delete(`/catalog/${id}`);
    await client.invalidateQueries({ queryKey: ["catalog"] });
    toastStore.getState().show("تم أرشفة المنتج.", "success");
  }

  async function purgeProduct(id: string, name: string) {
    const confirmed = window.confirm(
      `حذف «${name}» نهائياً؟\n\nلن يمكن استرجاعه. إن كان مزامناً مع Meta سيُخفى من الكتالوج هناك أيضاً.`
    );
    if (!confirmed) return;
    try {
      await api.delete(`/catalog/${id}`, { params: { permanent: true } });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      toastStore.getState().show("تم حذف المنتج نهائياً.", "success");
    } catch {
      toastStore.getState().show("تعذر الحذف النهائي.", "error");
    }
  }

  async function restoreProduct(id: string) {
    await api.patch(`/catalog/${id}`, { is_active: true });
    await client.invalidateQueries({ queryKey: ["catalog"] });
    toastStore.getState().show("تم استرجاع المنتج.", "success");
  }

  async function bulkArchive() {
    if (!selectedCount) return;
    if (!window.confirm(`أرشفة ${selectedCount} منتج؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-archive", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      const { succeeded, failed } = result.data;
      toastStore.getState().show(
        failed === 0 ? `تم أرشفة ${succeeded} منتج.` : `أُرشف ${succeeded}، فشل ${failed}.`,
        failed && failed === succeeded + failed ? "error" : "success"
      );
    } catch {
      toastStore.getState().show("تعذر أرشفة المنتجات المحدّدة.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function bulkRestore() {
    if (!selectedCount) return;
    if (!window.confirm(`استرجاع ${selectedCount} منتج؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-restore", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      const { succeeded, failed } = result.data;
      toastStore.getState().show(
        failed === 0 ? `تم استرجاع ${succeeded} منتج.` : `استُرجع ${succeeded}، فشل ${failed}.`,
        failed && failed === succeeded + failed ? "error" : "success"
      );
    } catch {
      toastStore.getState().show("تعذر استرجاع المنتجات المحدّدة.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function bulkPurge() {
    if (!selectedCount) return;
    if (
      !window.confirm(
        `حذف ${selectedCount} منتج نهائياً؟\n\nلن يمكن استرجاعها. إن كانت مزامَنة مع Meta ستُخفى من الكتالوج هناك أيضاً.`
      )
    ) {
      return;
    }
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-purge", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      const { succeeded, failed } = result.data;
      toastStore.getState().show(
        failed === 0 ? `تم حذف ${succeeded} منتج نهائياً.` : `حُذف ${succeeded}، فشل ${failed}.`,
        failed && failed === succeeded + failed ? "error" : "success"
      );
    } catch {
      toastStore.getState().show("تعذر الحذف النهائي للمنتجات المحدّدة.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function uploadProductImage(file: File) {
    if (!file.type.startsWith("image/")) {
      toastStore.getState().show("اختر صورة فقط.", "error");
      return;
    }
    setUploadingImage(true);
    try {
      const uploaded = await uploadFile(file);
      setEditForm((current) => ({ ...current, imageUrl: uploaded.public_url }));
      toastStore.getState().show("تم رفع الصورة.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploadingImage(false);
    }
  }

  async function prepareCommerceIds() {
    setShowToolsMenu(false);
    try {
      const result = await api.post("/catalog/prepare-commerce");
      await client.invalidateQueries({ queryKey: ["catalog"] });
      toastStore.getState().show(`تم تجهيز ${result.data.updated} منتج بمعرّف Meta.`, "success");
    } catch {
      toastStore.getState().show("تعذر التجهيز.", "error");
    }
  }

  async function toggleMetaSync(product: CatalogProduct) {
    const next = product.meta_sync_enabled === false;
    try {
      await api.patch(`/catalog/${product.id}`, { meta_sync_enabled: next });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      toastStore.getState().show(
        next ? "تم تفعيل مزامنة Meta للمنتج." : "تم إيقاف مزامنة Meta — لن يُرسل عند المزامنة الجماعية.",
        "success"
      );
    } catch {
      toastStore.getState().show("تعذر تحديث إعداد المزامنة.", "error");
    }
  }

  async function syncProductToMeta(product: CatalogProduct) {
    if (product.meta_sync_enabled === false) {
      toastStore.getState().show("فعّل مزامنة Meta للمنتج أولاً.", "error");
      return;
    }
    setSyncingProductId(product.id);
    try {
      const result = await api.post<{
        synced: number;
        failed: number;
        pending?: number;
        approved?: number;
        rejected?: number;
        errors?: string[];
      }>(`/catalog/${product.id}/sync-meta`);
      await client.invalidateQueries({ queryKey: ["catalog"] });
      const { synced, failed, pending = 0, approved = 0, errors = [] } = result.data;
      if (synced > 0) {
        toastStore.getState().show(
          `تمت مزامنة «${product.name}» — معتمد ${approved}، قيد المراجعة ${pending}.`,
          "success"
        );
      } else if (errors[0]) {
        toastStore.getState().show(errors[0], "error");
      } else {
        toastStore.getState().show(product.meta_sync_error ?? "تعذر مزامنة المنتج مع Meta.", "error");
      }
      if (failed > 0 && errors[0] && synced > 0) {
        toastStore.getState().show(errors[0], "error");
      }
    } catch (error: unknown) {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
          ? (error as { response: { data: { detail: string } } }).response.data.detail
          : null;
      toastStore.getState().show(detail ?? "تعذر مزامنة المنتج.", "error");
    } finally {
      setSyncingProductId(null);
    }
  }

  async function refreshMetaStatus() {
    setShowToolsMenu(false);
    setRefreshingMetaStatus(true);
    try {
      const result = await api.post<{
        refreshed: number;
        failed: number;
        total: number;
        pending: number;
        approved: number;
        rejected: number;
      }>("/catalog/refresh-meta-status");
      await client.invalidateQueries({ queryKey: ["catalog"] });
      const { refreshed, failed, pending, approved, rejected } = result.data;
      if (result.data.total === 0) {
        toastStore.getState().show("لا توجد منتجات مزامَنة مع Meta بعد. استخدم «مزامنة المنتجات → Meta» من صفحة ربط WhatsApp.", "error");
        return;
      }
      toastStore.getState().show(
        `حالة Meta: ${refreshed} محدّث — معتمد ${approved}، قيد المراجعة ${pending}، مرفوض ${rejected}${failed ? `، فشل ${failed}` : ""}.`,
        failed ? "error" : "success"
      );
    } catch (error: unknown) {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
          ? (error as { response: { data: { detail: string } } }).response.data.detail
          : null;
      toastStore.getState().show(detail ?? "تعذر تحديث حالة Meta.", "error");
    } finally {
      setRefreshingMetaStatus(false);
    }
  }

  async function exportCatalog() {
    setShowToolsMenu(false);
    try {
      await downloadCatalogExport({ includeInactive: listTab === "inactive", format: "xlsx" });
      toastStore.getState().show("تم تصدير المنتجات إلى Excel.", "success");
    } catch {
      toastStore.getState().show("تعذر التصدير.", "error");
    }
  }

  function renderProductActions(item: CatalogProduct, compact = false) {
    return (
      <div className={`catalog-table-actions${compact ? " catalog-table-actions-compact" : ""}`}>
        <button type="button" className="contacts-erp-btn" onClick={() => openDetail(item)}>
          تفاصيل
        </button>
        {item.meta_item_group_id?.trim() && (
          <Link
            to={`/catalog/group/${encodeURIComponent(item.meta_item_group_id.trim())}/edit`}
            className="contacts-erp-btn"
          >
            المجموعة
          </Link>
        )}
        <button type="button" className="contacts-erp-btn" onClick={() => openEdit(item)}>تعديل</button>
        {item.is_active && item.meta_sync_enabled !== false && (
          <button
            type="button"
            className="contacts-erp-btn"
            disabled={syncingProductId === item.id}
            onClick={() => void syncProductToMeta(item)}
          >
            {syncingProductId === item.id ? "جاري…" : "مزامنة"}
          </button>
        )}
        {item.is_active && (
          <button type="button" className="contacts-erp-btn" onClick={() => void toggleMetaSync(item)}>
            {item.meta_sync_enabled === false ? "تفعيل Meta" : "إيقاف Meta"}
          </button>
        )}
        {item.is_active ? (
          <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" onClick={() => void deactivateProduct(item.id)}>
            أرشفة
          </button>
        ) : (
          <>
            <button type="button" className="contacts-erp-btn" onClick={() => void restoreProduct(item.id)}>
              استرجاع
            </button>
            <button
              type="button"
              className="contacts-erp-btn contacts-erp-btn-danger"
              onClick={() => void purgeProduct(item.id, item.name)}
            >
              حذف نهائي
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell">
        <header className="contacts-erp-header catalog-page-header">
          <div className="contacts-erp-title-block">
            <span className="contacts-erp-eyebrow">كتالوج الشركة</span>
            <h1>المنتجات والخدمات</h1>
            <p className="hint-text">
              ظهور واتساب يُؤكَّد فقط بدليل على كتالوج الرقم المحدد — اعتماد Meta وحده لا يكفي.
            </p>
          </div>
          <div className="catalog-header-actions">
            <Link to="/catalog/new" className="contacts-erp-btn contacts-erp-btn-primary">
              إضافة منتج
            </Link>
            <Link to="/catalog/orders" className="contacts-erp-btn">طلبات الكتالوج</Link>
            <div className="catalog-tools-menu" ref={toolsMenuRef}>
              <button
                type="button"
                className="contacts-erp-btn"
                aria-expanded={showToolsMenu}
                onClick={() => setShowToolsMenu((value) => !value)}
              >
                أدوات إضافية
              </button>
              {showToolsMenu && (
                <div className="catalog-tools-dropdown" role="menu">
                  <Link to="/catalog/new?mode=offer" className="catalog-tools-item" onClick={() => setShowToolsMenu(false)}>
                    إنشاء عرض
                  </Link>
                  <Link to="/catalog/category/new" className="catalog-tools-item" onClick={() => setShowToolsMenu(false)}>
                    إنشاء صنف
                  </Link>
                  <button type="button" className="catalog-tools-item" onClick={() => void prepareCommerceIds()}>
                    تجهيز Meta IDs
                  </button>
                  <button
                    type="button"
                    className="catalog-tools-item"
                    disabled={refreshingMetaStatus}
                    onClick={() => void refreshMetaStatus()}
                  >
                    {refreshingMetaStatus ? "جاري التحديث…" : "تحديث حالة Meta يدوياً"}
                  </button>
                  <button type="button" className="catalog-tools-item" onClick={() => void exportCatalog()}>
                    تصدير Excel
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="contacts-erp-btn contacts-erp-btn-ghost"
              onClick={() => setShowPreview((value) => !value)}
            >
              {showPreview ? "إخفاء المعاينة" : "معاينة رد واتساب"}
            </button>
          </div>
        </header>

        <div className="catalog-scope-row">
          <select
            value={filterOrganizationId}
            onChange={(e) => {
              setFilterOrganizationId(e.target.value);
              setFilterChannelId("");
            }}
            className="contacts-erp-channel-filter"
            aria-label="تصفية حسب الفرع"
          >
            <option value="">كل الفروع</option>
            {(organizations.data ?? []).map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          <select
            value={filterChannelId}
            onChange={(e) => setFilterChannelId(e.target.value)}
            className="contacts-erp-channel-filter"
            aria-label="رقم واتساب"
          >
            <option value="">كل القنوات</option>
            {channelOptions.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.label}{channel.phone ? ` · ${channel.phone}` : ""}
              </option>
            ))}
          </select>
          <div className="catalog-filter-tabs catalog-filter-tabs-inline">
            <button type="button" className={listTab === "active" ? "active" : ""} onClick={() => setListTab("active")}>
              نشطة
            </button>
            <button type="button" className={listTab === "inactive" ? "active" : ""} onClick={() => setListTab("inactive")}>
              مؤرشفة
            </button>
          </div>
        </div>

        <section className="catalog-visibility-board" aria-label="ملخص ظهور واتساب حسب الفرع والقناة">
          <div className="catalog-visibility-board-head">
            <div>
              <h2>ظهور واتساب</h2>
              <p>
                {visibilitySummary.requiresChannelSelection
                  ? "ملخص عام لكل المنتجات المحمّلة. اختر رقم واتساب للاطلاع على حالة الظهور الخاصة به."
                  : "الأعداد خاصة بالرقم والكتالوج المحددين. منتجات رقم آخر في نفس الفرع لا تدخل في مؤكد الظهور."}
              </p>
            </div>
            <small>
              {visibilitySummary.total.toLocaleString("ar")} منتج مطابق
              {debouncedSearch ? " للبحث" : ""}
            </small>
          </div>
          {visibilityScope.channelId && visibilityScope.isCatalogVisible === false && (
            <p className="catalog-visibility-channel-warning">
              كتالوج هذا الرقم مخفي في إعدادات واتساب — لا يُعرض أي منتج كـ«مؤكد الظهور» حتى يُفعَّل الظهور على الرقم.
            </p>
          )}
          <div className="catalog-visibility-grid">
            {visibilitySummary.cards.map((card) => {
              const selected = visibilityFilter === card.status;
              return (
                <button
                  key={card.status}
                  type="button"
                  className={`catalog-visibility-card visibility-${card.status}${selected ? " active" : ""}`}
                  onClick={() => setVisibilityFilter((current) => (current === card.status ? "all" : card.status))}
                  aria-pressed={selected}
                >
                  <span className="catalog-visibility-label">{card.label}</span>
                  <strong className="catalog-visibility-count">{card.count.toLocaleString("ar")}</strong>
                  <small className="catalog-visibility-hint">{card.hint}</small>
                  {selected && <span className="catalog-visibility-selected">✓ محدد</span>}
                </button>
              );
            })}
          </div>
        </section>

        <div className="contacts-erp-toolbar catalog-list-toolbar">
          <div className="contacts-erp-actions catalog-list-toolbar-title">
            <h2 className="catalog-results-title">{resultsTitle}</h2>
            {visibilityFilter !== "all" && (
              <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={() => setVisibilityFilter("all")}>
                إلغاء فلتر الحالة
              </button>
            )}
            {selectedCount > 0 && (
              <>
                <span className="contacts-selection-badge">{selectedCount} محدّد</span>
                {listTab === "active" ? (
                  <>
                    <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" disabled={bulkProcessing} onClick={() => void bulkArchive()}>
                      {bulkProcessing ? "جاري…" : "أرشفة المحدّد"}
                    </button>
                    <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" disabled={bulkProcessing} onClick={() => void bulkPurge()}>
                      {bulkProcessing ? "جاري…" : "حذف نهائي للمحدّد"}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="contacts-erp-btn" disabled={bulkProcessing} onClick={() => void bulkRestore()}>
                      {bulkProcessing ? "جاري…" : "استرجاع المحدّد"}
                    </button>
                    <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" disabled={bulkProcessing} onClick={() => void bulkPurge()}>
                      {bulkProcessing ? "جاري…" : "حذف نهائي للمحدّد"}
                    </button>
                  </>
                )}
                <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={clearSelection}>
                  إلغاء التحديد
                </button>
              </>
            )}
          </div>
          <div className="contacts-erp-meta">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as CatalogTypeFilter)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب النوع"
            >
              <option value="all">الكل</option>
              <option value="product">منتجات</option>
              <option value="service">خدمات</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب الصنف"
            >
              <option value="">كل الأصناف</option>
              {(categories.data ?? []).map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <div className="contacts-erp-search">
              <Icon name="search" size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم، SKU، أو كلمات مفتاحية…"
                aria-label="بحث في المنتجات"
              />
            </div>
            <div className="contacts-erp-pagination">
              <span>
                {total === 0
                  ? "0 منتج"
                  : pageSize === 0
                    ? `${total} منتج`
                    : `${pageStart}-${pageEnd} من ${total} · صفحة ${safePage}/${totalPages}`}
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="contacts-erp-channel-filter"
                aria-label="عدد المنتجات في الصفحة"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size === 0 ? "عرض الكل" : `${size} / صفحة`}
                  </option>
                ))}
              </select>
              <button type="button" disabled={safePage <= 1 || pageSize === 0} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="السابق">
                ‹
              </button>
              <button type="button" disabled={safePage >= totalPages || pageSize === 0} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="التالي">
                ›
              </button>
            </div>
          </div>
        </div>

        {showPreview && (
          <section className="card catalog-preview-card catalog-preview-inline" aria-label="معاينة رد واتساب">
            <h2 className="section-title">معاينة رد واتساب</h2>
            <p className="hint-text">هذه معاينة لنص الرد المقترح من الكتالوج — ليست معاينة لكتالوج واتساب نفسه.</p>
            <div className="catalog-preview-form">
              <label className="field-label">
                <span>استفسار العميل</span>
                <input value={previewQuery} onChange={(e) => setPreviewQuery(e.target.value)} placeholder="مثال: سعر المكيف 2 طن" />
              </label>
              <label className="field-label">
                <span>اسم العميل (اختياري)</span>
                <input value={previewContactName} onChange={(e) => setPreviewContactName(e.target.value)} placeholder="أحمد" />
              </label>
            </div>
            {previewQuery.trim() && (
              <div className="catalog-preview-layout">
                <WhatsAppTextPreview text={previewReply.data?.suggestion ?? "جاري التوليد…"} />
                {(previewReply.data?.matched_products ?? []).length > 0 && (
                  <div className="catalog-preview-products">
                    {(previewReply.data?.matched_products ?? []).map((matched) => (
                      <article key={matched.id} className="catalog-preview-product-chip">
                        {matched.image_url ? <img src={matched.image_url} alt={matched.name} /> : <span>📦</span>}
                        <div>
                          <strong>{matched.name}</strong>
                          <small>{matched.price_label}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <div className={`catalog-workspace${detailProduct ? " has-detail" : ""}`}>
          <div className="contacts-erp-table-wrap catalog-list-pane" ref={listScrollRef}>
            {products.isLoading && (
              <div className="contacts-erp-loading">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="contacts-erp-skeleton-row" />
                ))}
              </div>
            )}

            {products.isError && (
              <div className="contacts-erp-empty">
                <strong>تعذر تحميل المنتجات</strong>
                <button type="button" className="contacts-erp-btn" onClick={() => void products.refetch()}>إعادة المحاولة</button>
              </div>
            )}

            {!products.isLoading && !products.isError && total === 0 && (
              <div className="contacts-erp-empty">
                <strong>لا توجد منتجات مطابقة</strong>
                <p>جرّب تغيير الفلاتر أو أضف منتجاً جديداً.</p>
                <div className="contacts-erp-actions">
                  <Link to="/catalog/new" className="contacts-erp-btn contacts-erp-btn-primary">إنشاء منتج</Link>
                  {visibilityFilter !== "all" && (
                    <button type="button" className="contacts-erp-btn" onClick={() => setVisibilityFilter("all")}>
                      إلغاء فلتر الحالة
                    </button>
                  )}
                </div>
              </div>
            )}

            {total > 0 && !products.isLoading && (
              <>
                <div className="catalog-mobile-cards" aria-label="قائمة المنتجات للهاتف">
                  {pageRows.map((item) => {
                    const visibility = catalogWhatsAppVisibility(item, visibilityScope);
                    const showIssue = visibility.status === "broken" || visibility.status === "unknown";
                    return (
                      <article key={item.id} className={`catalog-mobile-card${item.is_active ? "" : " is-archived"}`}>
                        <label className="catalog-mobile-check">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleRowSelection(item.id)}
                            aria-label={`تحديد ${item.name}`}
                          />
                        </label>
                        <button type="button" className="catalog-mobile-main" onClick={() => openDetail(item)}>
                          {item.image_url ? (
                            <img src={item.image_url} alt="" className="catalog-table-thumb" loading="lazy" />
                          ) : (
                            <span className="catalog-table-thumb placeholder">{item.product_type === "service" ? "🛠" : "📦"}</span>
                          )}
                          <div className="catalog-mobile-copy">
                            <strong>{item.name}</strong>
                            <span>{catalogPriceLabel(item)}</span>
                            <span className={`catalog-visibility-pill ${visibility.className}`}>{visibility.label}</span>
                            {showIssue && (
                              <small className="catalog-visibility-reason">{visibility.reason}</small>
                            )}
                            {showIssue && (
                              <small className="catalog-visibility-next">{visibility.nextStep}</small>
                            )}
                          </div>
                        </button>
                        <div className="catalog-mobile-actions">
                          <button type="button" className="contacts-erp-btn" onClick={() => openEdit(item)}>تعديل</button>
                          {item.is_active ? (
                            <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" onClick={() => void deactivateProduct(item.id)}>
                              أرشفة
                            </button>
                          ) : (
                            <button type="button" className="contacts-erp-btn" onClick={() => void restoreProduct(item.id)}>
                              استرجاع
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <table className="contacts-erp-table catalog-erp-table catalog-desktop-table">
                  <thead>
                    <tr>
                      <th className="contacts-col-check">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = somePageSelected && !allPageSelected;
                          }}
                          onChange={togglePageSelection}
                          aria-label="تحديد الصفحة"
                        />
                      </th>
                      <th>المنتج</th>
                      <th>السعر</th>
                      <th>الفرع</th>
                      <th>حالة واتساب</th>
                      <th>آخر تحديث</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((item) => {
                      const visibility = catalogWhatsAppVisibility(item, visibilityScope);
                      const showIssueInline = visibility.status === "broken" || visibility.status === "unknown";
                      return (
                        <tr key={item.id} className={item.is_active ? "" : "catalog-row-inactive"}>
                          <td className="contacts-col-check">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleRowSelection(item.id)}
                              aria-label={`تحديد ${item.name}`}
                            />
                          </td>
                          <td>
                            <button type="button" className="catalog-product-cell" onClick={() => openDetail(item)}>
                              {item.image_url ? (
                                <img src={item.image_url} alt="" className="catalog-table-thumb" loading="lazy" />
                              ) : (
                                <span className="catalog-table-thumb placeholder">{item.product_type === "service" ? "🛠" : "📦"}</span>
                              )}
                              <span>
                                <strong>{item.name}</strong>
                                {formatCatalogVariantLabel(item) && (
                                  <small className="catalog-table-variant">{formatCatalogVariantLabel(item)}</small>
                                )}
                              </span>
                            </button>
                          </td>
                          <td>{catalogPriceLabel(item)}</td>
                          <td>{item.organization_id && orgMap.has(item.organization_id) ? orgMap.get(item.organization_id) : "—"}</td>
                          <td>
                            <span className={`catalog-visibility-pill ${visibility.className}`} title={visibility.reason}>
                              {visibility.label}
                            </span>
                            {showIssueInline && (
                              <div className="catalog-inline-issue">
                                <small className="catalog-visibility-reason">{visibility.reason}</small>
                                <small className="catalog-visibility-next">{visibility.nextStep}</small>
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="catalog-last-update">
                              <span>{visibility.lastUpdateAt ? formatAppDateTime(visibility.lastUpdateAt) : "—"}</span>
                              <small>{visibility.lastUpdateLabel}</small>
                            </div>
                          </td>
                          <td>{renderProductActions(item, true)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {detailProduct && (
            <aside className="catalog-detail-panel" aria-label="تفاصيل المنتج">
              <div className="catalog-detail-head">
                <h3>{detailProduct.name}</h3>
                <button type="button" className="panel-close" onClick={closeDetail} aria-label="إغلاق التفاصيل">×</button>
              </div>
              {(() => {
                const visibility = catalogWhatsAppVisibility(detailProduct, visibilityScope);
                const metaStatus = catalogMetaStatusLabel(detailProduct);
                return (
                  <div className="catalog-detail-body">
                    {detailProduct.image_url && (
                      <img src={detailProduct.image_url} alt={detailProduct.name} className="catalog-detail-image" />
                    )}
                    <dl className="catalog-detail-grid">
                      <div><dt>السعر</dt><dd>{catalogPriceLabel(detailProduct)}</dd></div>
                      <div><dt>النوع</dt><dd>{catalogTypeLabel(detailProduct.product_type)}</dd></div>
                      <div><dt>SKU</dt><dd dir="ltr">{detailProduct.sku || "—"}</dd></div>
                      <div><dt>الصنف</dt><dd>{detailProduct.category || "—"}</dd></div>
                      <div>
                        <dt>الفرع</dt>
                        <dd>{detailProduct.organization_id && orgMap.has(detailProduct.organization_id) ? orgMap.get(detailProduct.organization_id) : "—"}</dd>
                      </div>
                      <div><dt>الترتيب</dt><dd>{detailProduct.sort_order ?? 0}</dd></div>
                      <div><dt>الاستخدام</dt><dd>{detailProduct.usage_count > 0 ? detailProduct.usage_count : "—"}</dd></div>
                      <div>
                        <dt>حالة واتساب</dt>
                        <dd>
                          <span className={`catalog-visibility-pill ${visibility.className}`}>{visibility.label}</span>
                        </dd>
                      </div>
                      <div><dt>سبب الحالة</dt><dd>{visibility.reason}</dd></div>
                      <div><dt>الخطوة التالية</dt><dd>{visibility.nextStep}</dd></div>
                      <div><dt>آخر مزامنة</dt><dd>{visibility.lastSyncedAt ? formatAppDateTime(visibility.lastSyncedAt) : "—"}</dd></div>
                      <div>
                        <dt>آخر تحقق من الظهور</dt>
                        <dd>{visibility.lastVisibilityCheckedAt ? formatAppDateTime(visibility.lastVisibilityCheckedAt) : "—"}</dd>
                      </div>
                      <div>
                        <dt>Meta</dt>
                        <dd>
                          <span className={`catalog-meta-status-pill ${metaStatus.className}`}>{metaStatus.label}</span>
                          {metaStatus.detail && <small>{metaStatus.detail}</small>}
                        </dd>
                      </div>
                      <div>
                        <dt>الحالة</dt>
                        <dd>{detailProduct.is_active ? "نشط" : "مؤرشف"}</dd>
                      </div>
                      <div><dt>Meta ID</dt><dd dir="ltr">{detailProduct.external_id || "—"}</dd></div>
                    </dl>
                    {detailProduct.description && (
                      <p className="catalog-detail-description">{detailProduct.description}</p>
                    )}
                    {renderProductActions(detailProduct)}
                  </div>
                );
              })()}
            </aside>
          )}
        </div>
      </section>

      {editingProduct && (
        <div className="catalog-edit-overlay" role="dialog" aria-modal="true">
          <button type="button" className="catalog-edit-backdrop" aria-label="إغلاق" onClick={() => setEditingProduct(null)} />
          <form className="catalog-edit-panel stack-form catalog-simple-edit-panel" onSubmit={saveEdit}>
            <div className="catalog-edit-head">
              <h3>تعديل: {editingProduct.name}</h3>
              <button type="button" className="panel-close" onClick={() => setEditingProduct(null)}>×</button>
            </div>
            {editingProduct.meta_item_group_id?.trim() ? (
              <div className="catalog-group-edit-notice">
                <p className="hint-text">هذا المنتج جزء من مجموعة Meta — عدّله من صفحة المجموعة.</p>
                <Link
                  to={`/catalog/group/${encodeURIComponent(editingProduct.meta_item_group_id.trim())}/edit`}
                  className="contacts-erp-btn"
                  onClick={() => setEditingProduct(null)}
                >
                  تعديل المجموعة
                </Link>
              </div>
            ) : (
              <CatalogSimpleProductForm
                form={editForm}
                setForm={setEditForm}
                organizations={organizations.data ?? []}
                whatsappAccounts={whatsappAccounts.data ?? []}
                uploadingImage={uploadingImage}
                onUploadImage={(file) => void uploadProductImage(file)}
              />
            )}
            <div className="catalog-card-actions">
              {!editingProduct.meta_item_group_id?.trim() && (
                <button type="submit" className="whatsapp-button">حفظ التعديلات</button>
              )}
              <button type="button" className="secondary-button" onClick={() => setEditingProduct(null)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
