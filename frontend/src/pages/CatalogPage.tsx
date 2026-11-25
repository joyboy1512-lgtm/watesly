import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  catalogVisibilityShortLabel,
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
  sortCatalogProductsBy,
  summarizeCatalogVisibility,
  type CatalogListTab,
  type CatalogProduct,
  type CatalogReplyPreview,
  type CatalogSortKey,
  type CatalogTypeFilter,
  type CatalogVisibilityScope,
  type CatalogVisibilityStatus,
  type ProductFormState
} from "../lib/catalogHelpers";
import {
  buildCatalogUiDemoProducts,
  buildCatalogUiDemoProofs,
  CATALOG_UI_DEMO_CHANNELS,
  CATALOG_UI_DEMO_ORGS
} from "../lib/catalogUiDemo";
import { formatAppDate, formatAppDateTime } from "../lib/language";
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

type CatalogPageProps = {
  /** Local/demo preview with fixture data; no API mutations. */
  demoMode?: boolean;
};

export default function CatalogPage({ demoMode = false }: CatalogPageProps) {
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const isDemo = demoMode || searchParams.get("demo") === "1";
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const savedListScrollRef = useRef(0);

  const [listTab, setListTab] = useState<CatalogListTab>("active");
  const [typeFilter, setTypeFilter] = useState<CatalogTypeFilter>("all");
  const [filterOrganizationId, setFilterOrganizationId] = useState(isDemo ? "" : "");
  const [filterChannelId, setFilterChannelId] = useState(isDemo ? "ch-a" : "");
  const [filterCategory, setFilterCategory] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<CatalogVisibilityStatus | "all">(
    isDemo ? "broken" : "all"
  );
  const [sortKey, setSortKey] = useState<CatalogSortKey>("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [solutionProductId, setSolutionProductId] = useState<string | null>(null);

  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [editForm, setEditForm] = useState<ProductFormState>(emptyProductForm);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [refreshingMetaStatus, setRefreshingMetaStatus] = useState(false);
  const [syncingProductId, setSyncingProductId] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [previewContactName, setPreviewContactName] = useState("");

  const demoProducts = useMemo(() => (isDemo ? buildCatalogUiDemoProducts() : []), [isDemo]);
  const demoProofs = useMemo(() => (isDemo ? buildCatalogUiDemoProofs() : {}), [isDemo]);

  const previewReply = useQuery({
    queryKey: ["catalog-preview", previewQuery, previewContactName],
    enabled: !isDemo && previewQuery.trim().length > 0,
    queryFn: async () => (
      await api.post<CatalogReplyPreview>("/catalog/preview-reply", {
        query: previewQuery.trim(),
        contact_name: previewContactName.trim()
      })
    ).data
  });

  const organizations = useQuery({
    queryKey: ["organizations"],
    enabled: !isDemo,
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const categories = useQuery({
    queryKey: ["catalog-categories"],
    enabled: !isDemo,
    queryFn: async () => (await api.get<string[]>("/catalog/categories")).data
  });

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    enabled: !isDemo,
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });

  const orgList = isDemo ? CATALOG_UI_DEMO_ORGS : (organizations.data ?? []);
  const waList = isDemo ? (CATALOG_UI_DEMO_CHANNELS as WhatsAppAccountRow[]) : (whatsappAccounts.data ?? []);

  const selectedWhatsApp = useMemo(
    () => waList.find((account) => account.channel_id === filterChannelId) ?? null,
    [waList, filterChannelId]
  );

  const commerceReadiness = useQuery({
    queryKey: ["catalog-commerce-readiness", selectedWhatsApp?.id],
    enabled: !isDemo && Boolean(selectedWhatsApp?.id),
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
  }, [listTab, typeFilter, filterOrganizationId, filterChannelId, filterCategory, visibilityFilter, debouncedSearch, pageSize, sortKey]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!toolsMenuRef.current?.contains(target)) setShowToolsMenu(false);
      if (!rowMenuRef.current?.contains(target)) setOpenRowMenuId(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgList) map.set(org.id, org.name);
    return map;
  }, [orgList]);

  const channelOptions = useMemo(() => {
    const scoped = filterOrganizationId
      ? waList.filter((account) => account.organization_id === filterOrganizationId)
      : waList;
    return scoped.map((account) => ({
      id: account.channel_id,
      label: account.verified_name || account.display_phone_number || account.channel_name || "WhatsApp",
      phone: account.display_phone_number
    }));
  }, [waList, filterOrganizationId]);

  const products = useQuery({
    queryKey: ["catalog", filterOrganizationId, filterChannelId] as const,
    enabled: !isDemo,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("include_inactive", "true");
      if (filterOrganizationId) params.set("organization_id", filterOrganizationId);
      if (filterChannelId) params.set("channel_id", filterChannelId);
      const result = await api.get<CatalogProduct[]>(`/catalog?${params.toString()}`);
      return result.data;
    }
  });

  const visibilityScope: CatalogVisibilityScope = useMemo(() => {
    if (!filterChannelId || !selectedWhatsApp) return emptyCatalogVisibilityScope();
    if (isDemo) {
      return emptyCatalogVisibilityScope({
        channelId: filterChannelId,
        organizationId: selectedWhatsApp.organization_id,
        accountId: selectedWhatsApp.id,
        metaCatalogId: selectedWhatsApp.meta_catalog_id ?? "cat-a",
        isCatalogVisible: true,
        catalogLinked: true,
        proofsByProductId: demoProofs
      });
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
  }, [filterChannelId, selectedWhatsApp, commerceReadiness.data, isDemo, demoProofs]);

  const rawProducts = isDemo ? demoProducts : (products.data ?? []);

  const categoryOptions = useMemo(() => {
    if (!isDemo) return categories.data ?? [];
    return Array.from(new Set(rawProducts.map((item) => item.category).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b, "ar")
    );
  }, [isDemo, categories.data, rawProducts]);

  const scopedProducts = useMemo(() => {
    let rows = rawProducts;
    if (isDemo && filterOrganizationId) {
      rows = rows.filter((item) => item.organization_id === filterOrganizationId);
    }
    if (isDemo && filterChannelId) {
      rows = rows.filter((item) => !item.channel_id || item.channel_id === filterChannelId);
    }
    if (filterCategory) {
      rows = rows.filter((item) => item.category === filterCategory);
    }
    rows = filterCatalogByType(rows, typeFilter);
    rows = filterCatalogBySearch(rows, debouncedSearch);
    return sortCatalogProductsBy(rows, sortKey);
  }, [rawProducts, isDemo, filterOrganizationId, filterChannelId, filterCategory, typeFilter, debouncedSearch, sortKey]);

  const visibilitySummary = useMemo(
    () => summarizeCatalogVisibility(scopedProducts, visibilityScope),
    [scopedProducts, visibilityScope]
  );

  const activeCount = useMemo(() => scopedProducts.filter((item) => item.is_active).length, [scopedProducts]);
  const archivedCount = useMemo(() => scopedProducts.filter((item) => !item.is_active).length, [scopedProducts]);

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

  const showBranchColumn = !filterOrganizationId && orgList.length > 1;
  const selectedOrgName = filterOrganizationId ? orgMap.get(filterOrganizationId) : null;
  const selectedChannelLabel = channelOptions.find((item) => item.id === filterChannelId)?.label;
  const scopeLabel = [
    selectedOrgName || "كل الفروع",
    selectedChannelLabel || "كل القنوات",
    `${visibilitySummary.total.toLocaleString("ar")} منتجًا`
  ].join(" · ");

  const activeVisibilityCard = visibilitySummary.cards.find((card) => card.status === visibilityFilter);
  const resultsTitle =
    visibilityFilter !== "all" && activeVisibilityCard
      ? `${activeVisibilityCard.fullLabel} · ${total.toLocaleString("ar")}`
      : listTab === "inactive"
        ? `المؤرشفة · ${total.toLocaleString("ar")}`
        : `النشطة · ${total.toLocaleString("ar")}`;

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
      if (allPageSelected) for (const id of pageIds) next.delete(id);
      else for (const id of pageIds) next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openDetail(product: CatalogProduct) {
    if (listScrollRef.current) savedListScrollRef.current = listScrollRef.current.scrollTop;
    setDetailProductId(product.id);
    setSolutionProductId(null);
    setOpenRowMenuId(null);
  }

  function closeDetail() {
    setDetailProductId(null);
    window.requestAnimationFrame(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = savedListScrollRef.current;
    });
  }

  function openEdit(product: CatalogProduct) {
    if (isDemo) {
      toastStore.getState().show("وضع المعاينة — التعديل معطّل.", "success");
      return;
    }
    setEditingProduct(product);
    setEditForm(productFormFromCatalog(product));
    setOpenRowMenuId(null);
  }

  function focusChannelSelect() {
    const el = document.getElementById("catalog-channel-filter");
    if (el instanceof HTMLSelectElement) el.focus();
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingProduct || isDemo) return;
    if (!editingProduct.meta_item_group_id?.trim() && !simpleProductFormReady(editForm, orgList.length, waList.length)) {
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
          response.data.meta_review_status === "rejected" || response.data.meta_sync_status === "failed" ? "error" : "success"
        );
      }
    } catch {
      toastStore.getState().show("تعذر التحديث.", "error");
    }
  }

  async function deactivateProduct(id: string) {
    if (isDemo) return;
    await api.delete(`/catalog/${id}`);
    await client.invalidateQueries({ queryKey: ["catalog"] });
    toastStore.getState().show("تم أرشفة المنتج.", "success");
  }

  async function purgeProduct(id: string, name: string) {
    if (isDemo) return;
    if (!window.confirm(`حذف «${name}» نهائياً؟\n\nلن يمكن استرجاعه.`)) return;
    try {
      await api.delete(`/catalog/${id}`, { params: { permanent: true } });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      toastStore.getState().show("تم حذف المنتج نهائياً.", "success");
    } catch {
      toastStore.getState().show("تعذر الحذف النهائي.", "error");
    }
  }

  async function restoreProduct(id: string) {
    if (isDemo) return;
    await api.patch(`/catalog/${id}`, { is_active: true });
    await client.invalidateQueries({ queryKey: ["catalog"] });
    toastStore.getState().show("تم استرجاع المنتج.", "success");
  }

  async function bulkArchive() {
    if (!selectedCount || isDemo) return;
    if (!window.confirm(`أرشفة ${selectedCount} منتج؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-archive", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      toastStore.getState().show(`تم أرشفة ${result.data.succeeded} منتج.`, "success");
    } catch {
      toastStore.getState().show("تعذر أرشفة المنتجات المحدّدة.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function bulkRestore() {
    if (!selectedCount || isDemo) return;
    if (!window.confirm(`استرجاع ${selectedCount} منتج؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-restore", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      toastStore.getState().show(`تم استرجاع ${result.data.succeeded} منتج.`, "success");
    } catch {
      toastStore.getState().show("تعذر استرجاع المنتجات المحدّدة.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function bulkPurge() {
    if (!selectedCount || isDemo) return;
    if (!window.confirm(`حذف ${selectedCount} منتج نهائياً؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-purge", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      toastStore.getState().show(`تم حذف ${result.data.succeeded} منتج نهائياً.`, "success");
    } catch {
      toastStore.getState().show("تعذر الحذف النهائي للمنتجات المحدّدة.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function bulkSetMetaSync(enabled: boolean) {
    if (!selectedCount || isDemo) return;
    const label = enabled ? "تفعيل" : "إيقاف";
    if (!window.confirm(`${label} مزامنة Meta لـ ${selectedCount} منتج؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/catalog/bulk-meta-sync-enabled", {
        product_ids: [...selectedIds],
        enabled
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      toastStore.getState().show(
        enabled
          ? `تم تفعيل مزامنة Meta لـ ${result.data.succeeded} منتج.`
          : `تم إيقاف مزامنة Meta لـ ${result.data.succeeded} منتج.`,
        result.data.failed ? "error" : "success"
      );
    } catch {
      toastStore.getState().show("تعذر تحديث مزامنة Meta للمحدّد.", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  async function bulkSyncMeta() {
    if (!selectedCount || isDemo) return;
    if (!window.confirm(`مزامنة ${selectedCount} منتج مع Meta الآن؟`)) return;
    setBulkProcessing(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number; skipped: number }>("/catalog/bulk-sync-meta", {
        product_ids: [...selectedIds]
      });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      clearSelection();
      const { succeeded, failed, skipped } = result.data;
      toastStore.getState().show(
        `مزامنة Meta: نجح ${succeeded}${skipped ? `، تُخطّي ${skipped}` : ""}${failed ? `، فشل ${failed}` : ""}.`,
        failed && !succeeded ? "error" : "success"
      );
    } catch {
      toastStore.getState().show("تعذر مزامنة المنتجات المحدّدة مع Meta.", "error");
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
    if (isDemo) return;
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
    if (isDemo) return;
    const next = product.meta_sync_enabled === false;
    try {
      await api.patch(`/catalog/${product.id}`, { meta_sync_enabled: next });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      toastStore.getState().show(next ? "تم تفعيل مزامنة Meta." : "تم إيقاف مزامنة Meta.", "success");
    } catch {
      toastStore.getState().show("تعذر تحديث إعداد المزامنة.", "error");
    }
  }

  async function syncProductToMeta(product: CatalogProduct) {
    if (isDemo) return;
    if (product.meta_sync_enabled === false) {
      toastStore.getState().show("فعّل مزامنة Meta للمنتج أولاً.", "error");
      return;
    }
    setSyncingProductId(product.id);
    try {
      const result = await api.post<{ synced: number; pending?: number; approved?: number; errors?: string[] }>(
        `/catalog/${product.id}/sync-meta`
      );
      await client.invalidateQueries({ queryKey: ["catalog"] });
      if (result.data.synced > 0) {
        toastStore.getState().show(`تمت مزامنة «${product.name}».`, "success");
      } else {
        toastStore.getState().show(result.data.errors?.[0] ?? "تعذر مزامنة المنتج مع Meta.", "error");
      }
    } catch {
      toastStore.getState().show("تعذر مزامنة المنتج.", "error");
    } finally {
      setSyncingProductId(null);
    }
  }

  async function refreshMetaStatus() {
    if (isDemo) return;
    setShowToolsMenu(false);
    setRefreshingMetaStatus(true);
    try {
      const result = await api.post<{ refreshed: number; failed: number; total: number; pending: number; approved: number; rejected: number }>(
        "/catalog/refresh-meta-status"
      );
      await client.invalidateQueries({ queryKey: ["catalog"] });
      if (result.data.total === 0) {
        toastStore.getState().show("لا توجد منتجات مزامَنة مع Meta بعد.", "error");
        return;
      }
      toastStore.getState().show(`حالة Meta: ${result.data.refreshed} محدّث.`, result.data.failed ? "error" : "success");
    } catch {
      toastStore.getState().show("تعذر تحديث حالة Meta.", "error");
    } finally {
      setRefreshingMetaStatus(false);
    }
  }

  async function exportCatalog() {
    setShowToolsMenu(false);
    if (isDemo) {
      toastStore.getState().show("وضع المعاينة — التصدير معطّل.", "success");
      return;
    }
    try {
      await downloadCatalogExport({ includeInactive: listTab === "inactive", format: "xlsx" });
      toastStore.getState().show("تم تصدير المنتجات إلى Excel.", "success");
    } catch {
      toastStore.getState().show("تعذر التصدير.", "error");
    }
  }

  function formatUpdateCell(product: CatalogProduct) {
    const visibility = catalogWhatsAppVisibility(product, visibilityScope);
    if (!visibility.lastUpdateAt) return { label: "—", short: "—", full: "" };
    const short = formatAppDate(visibility.lastUpdateAt, { day: "numeric", month: "short" });
    const full = formatAppDateTime(visibility.lastUpdateAt);
    return { label: visibility.lastUpdateLabel, short, full };
  }

  function renderRowMenu(item: CatalogProduct) {
    const open = openRowMenuId === item.id;
    return (
      <div className="catalog-row-menu" ref={open ? rowMenuRef : undefined}>
        <button
          type="button"
          className="catalog-row-menu-trigger"
          aria-label={`إجراءات ${item.name}`}
          aria-expanded={open}
          onClick={() => setOpenRowMenuId(open ? null : item.id)}
        >
          ⋯
        </button>
        {open && (
          <div className="catalog-row-menu-dropdown" role="menu">
            <button type="button" className="catalog-tools-item" onClick={() => openEdit(item)}>تعديل</button>
            <button
              type="button"
              className="catalog-tools-item"
              onClick={() => {
                setShowPreview(true);
                setOpenRowMenuId(null);
              }}
            >
              معاينة رد واتساب
            </button>
            {item.is_active && item.meta_sync_enabled !== false && (
              <button
                type="button"
                className="catalog-tools-item"
                disabled={syncingProductId === item.id || isDemo}
                onClick={() => void syncProductToMeta(item)}
              >
                {syncingProductId === item.id ? "جاري…" : "مزامنة Meta"}
              </button>
            )}
            {item.is_active && (
              <button type="button" className="catalog-tools-item" disabled={isDemo} onClick={() => void toggleMetaSync(item)}>
                {item.meta_sync_enabled === false ? "تفعيل Meta" : "إيقاف Meta"}
              </button>
            )}
            {item.meta_item_group_id?.trim() && (
              <Link
                to={`/catalog/group/${encodeURIComponent(item.meta_item_group_id.trim())}/edit`}
                className="catalog-tools-item"
                onClick={() => setOpenRowMenuId(null)}
              >
                تعديل المجموعة
              </Link>
            )}
            <hr className="catalog-menu-sep" />
            {item.is_active ? (
              <button
                type="button"
                className="catalog-tools-item catalog-tools-danger"
                disabled={isDemo}
                onClick={() => void deactivateProduct(item.id)}
              >
                أرشفة
              </button>
            ) : (
              <>
                <button type="button" className="catalog-tools-item" disabled={isDemo} onClick={() => void restoreProduct(item.id)}>
                  استرجاع
                </button>
                <button
                  type="button"
                  className="catalog-tools-item catalog-tools-danger"
                  disabled={isDemo}
                  onClick={() => void purgeProduct(item.id, item.name)}
                >
                  حذف نهائي
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const loading = !isDemo && products.isLoading;
  const errored = !isDemo && products.isError;

  return (
    <main className={`page catalog-page contacts-erp-page${isDemo ? " catalog-demo-mode" : ""}`}>
      <section className="contacts-erp-shell catalog-shell">
        {isDemo && (
          <div className="catalog-demo-banner" role="status">
            معاينة ببيانات تجريبية — الملخص يشمل المؤرشف ({visibilitySummary.total}) بينما تبويب النشطة يعرض {activeCount}.
          </div>
        )}

        <header className="catalog-topbar">
          <div className="catalog-title-card">
            <h1 className="catalog-topbar-title">المنتجات والخدمات</h1>
          </div>
          <div className="catalog-topbar-actions">
            <Link to="/catalog/new" className="contacts-erp-btn contacts-erp-btn-primary">
              + إضافة منتج
            </Link>
            <Link to="/catalog/orders" className="contacts-erp-btn">طلبات الكتالوج</Link>
            <div className="catalog-tools-menu" ref={toolsMenuRef}>
              <button
                type="button"
                className="contacts-erp-btn"
                aria-expanded={showToolsMenu}
                onClick={() => setShowToolsMenu((value) => !value)}
              >
                المزيد
              </button>
              {showToolsMenu && (
                <div className="catalog-tools-dropdown" role="menu">
                  <Link to="/catalog/new?mode=offer" className="catalog-tools-item" onClick={() => setShowToolsMenu(false)}>
                    إنشاء عرض
                  </Link>
                  <Link to="/catalog/category/new" className="catalog-tools-item" onClick={() => setShowToolsMenu(false)}>
                    إنشاء صنف
                  </Link>
                  <button type="button" className="catalog-tools-item" onClick={() => void exportCatalog()}>
                    تصدير Excel
                  </button>
                  <button
                    type="button"
                    className="catalog-tools-item"
                    onClick={() => {
                      setShowPreview(true);
                      setShowToolsMenu(false);
                    }}
                  >
                    معاينة رد واتساب
                  </button>
                  <hr className="catalog-menu-sep" />
                  <button type="button" className="catalog-tools-item" disabled={isDemo} onClick={() => void prepareCommerceIds()}>
                    تجهيز Meta IDs
                  </button>
                  <button
                    type="button"
                    className="catalog-tools-item"
                    disabled={refreshingMetaStatus || isDemo}
                    onClick={() => void refreshMetaStatus()}
                  >
                    {refreshingMetaStatus ? "جاري التحديث…" : "تحديث حالة Meta"}
                  </button>
                </div>
              )}
            </div>
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
            aria-label="الفرع"
          >
            <option value="">كل الفروع</option>
            {orgList.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          <select
            id="catalog-channel-filter"
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
        </div>

        <section className="catalog-visibility-board" aria-label="حالة الكتالوج على واتساب">
          <div className="catalog-visibility-board-head">
            <div>
              <h2>حالة الكتالوج على واتساب</h2>
              <p className="catalog-scope-meta">
                <span>{scopeLabel}</span>
                {archivedCount > 0 && (
                  <span className="catalog-scope-note">
                    {" "}· يشمل المؤرشف ({archivedCount.toLocaleString("ar")}) — النشطة {activeCount.toLocaleString("ar")}
                  </span>
                )}
              </p>
            </div>
          </div>
          {visibilityScope.channelId && visibilityScope.isCatalogVisible === false && (
            <p className="catalog-visibility-channel-warning">
              كتالوج هذا الرقم مخفي في إعدادات واتساب — لا يُعرض «مؤكد» حتى يُفعَّل الظهور.
            </p>
          )}
          <div className="catalog-visibility-grid">
            {visibilitySummary.cards.map((card) => {
              const selected = visibilityFilter === card.status;
              const alert = card.status === "broken" && (card.displayCount ?? 0) > 0;
              const quiet = card.displayCount === 0;
              return (
                <button
                  key={card.status}
                  type="button"
                  title={card.hint}
                  className={[
                    "brand-stat-card",
                    "catalog-visibility-card",
                    `visibility-${card.status}`,
                    selected ? "active is-active" : "",
                    alert ? "has-alert" : "",
                    quiet ? "is-quiet" : ""
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (card.needsChannelSelection) {
                      focusChannelSelect();
                      return;
                    }
                    setVisibilityFilter((current) => (current === card.status ? "all" : card.status));
                  }}
                  aria-pressed={selected}
                >
                  <span className="brand-stat-label catalog-visibility-label">{card.label}</span>
                  <strong className="brand-stat-value catalog-visibility-count">
                    {card.displayCount == null ? "—" : card.displayCount.toLocaleString("ar")}
                  </strong>
                  {card.needsChannelSelection ? (
                    <span className="brand-stat-meta catalog-visibility-action">اختر رقم واتساب</span>
                  ) : selected ? (
                    <span className="brand-stat-meta catalog-visibility-selected">✓ محدد</span>
                  ) : (
                    <span className="brand-stat-meta catalog-visibility-action">اضغط للتصفية</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <div className="catalog-list-head">
          <div className="catalog-filter-tabs">
            <button type="button" className={listTab === "active" && visibilityFilter === "all" ? "active" : ""} onClick={() => { setListTab("active"); setVisibilityFilter("all"); }}>
              نشطة ({activeCount.toLocaleString("ar")})
            </button>
            <button type="button" className={listTab === "inactive" && visibilityFilter === "all" ? "active" : ""} onClick={() => { setListTab("inactive"); setVisibilityFilter("all"); }}>
              مؤرشفة ({archivedCount.toLocaleString("ar")})
            </button>
          </div>
          <div className="catalog-list-head-meta">
            {visibilityFilter !== "all" && activeVisibilityCard ? (
              <button
                type="button"
                className="catalog-status-chip"
                onClick={() => setVisibilityFilter("all")}
                aria-label="إلغاء فلتر الحالة"
              >
                الحالة: {activeVisibilityCard.label} · {total.toLocaleString("ar")} ×
              </button>
            ) : (
              <h2 className="catalog-results-title">{resultsTitle}</h2>
            )}
            {selectedOrgName && !showBranchColumn && (
              <span className="catalog-branch-chip">{selectedOrgName}</span>
            )}
          </div>
        </div>

        {selectedCount > 0 && (
          <div className="catalog-bulk-bar catalog-bulk-bar-sticky" role="toolbar" aria-label="إجراءات جماعية">
            <span className="contacts-selection-badge">{selectedCount} محدّد</span>
            <button
              type="button"
              className="contacts-erp-btn contacts-erp-btn-primary"
              disabled={bulkProcessing || isDemo}
              onClick={() => void bulkSyncMeta()}
            >
              {bulkProcessing ? "جاري…" : "مزامنة Meta"}
            </button>
            <button
              type="button"
              className="contacts-erp-btn"
              disabled={bulkProcessing || isDemo}
              onClick={() => void bulkSetMetaSync(true)}
            >
              تفعيل Meta
            </button>
            <button
              type="button"
              className="contacts-erp-btn"
              disabled={bulkProcessing || isDemo}
              onClick={() => void bulkSetMetaSync(false)}
            >
              إيقاف Meta
            </button>
            {listTab === "active" || visibilityFilter !== "all" ? (
              <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" disabled={bulkProcessing || isDemo} onClick={() => void bulkArchive()}>
                أرشفة
              </button>
            ) : (
              <button type="button" className="contacts-erp-btn" disabled={bulkProcessing || isDemo} onClick={() => void bulkRestore()}>
                استرجاع
              </button>
            )}
            <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" disabled={bulkProcessing || isDemo} onClick={() => void bulkPurge()}>
              حذف نهائي
            </button>
            <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={clearSelection}>إلغاء</button>
          </div>
        )}

        <div className="catalog-table-toolbar">
          <div className="contacts-erp-search catalog-search-wide">
            <Icon name="search" size={16} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو SKU…"
              aria-label="بحث في المنتجات"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="contacts-erp-channel-filter"
            aria-label="الصنف"
          >
            <option value="">كل الأصناف</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CatalogTypeFilter)}
            className="contacts-erp-channel-filter"
            aria-label="النوع"
          >
            <option value="all">الكل</option>
            <option value="product">منتجات</option>
            <option value="service">خدمات</option>
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as CatalogSortKey)}
            className="contacts-erp-channel-filter"
            aria-label="الفرز"
          >
            <option value="name">فرز: الاسم</option>
            <option value="price">فرز: السعر</option>
            <option value="updated">فرز: آخر تحديث</option>
          </select>
        </div>

        {showPreview && (
          <section className="card catalog-preview-card catalog-preview-inline" aria-label="معاينة رد واتساب">
            <div className="catalog-preview-head">
              <h2 className="section-title">معاينة رد واتساب</h2>
              <button type="button" className="panel-close" onClick={() => setShowPreview(false)} aria-label="إغلاق المعاينة">×</button>
            </div>
            <p className="hint-text">معاينة لنص الرد المقترح من الكتالوج — ليست معاينة لكتالوج واتساب.</p>
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
              <WhatsAppTextPreview
                text={
                  isDemo
                    ? `مرحباً${previewContactName ? ` ${previewContactName}` : ""},\nإليك ما وجدناه في الكتالوج حول «${previewQuery}».`
                    : (previewReply.data?.suggestion ?? "جاري التوليد…")
                }
              />
            )}
          </section>
        )}

        <div className={`catalog-workspace${detailProduct ? " has-detail" : ""}`}>
          <div className="contacts-erp-table-wrap catalog-list-pane" ref={listScrollRef}>
            {loading && (
              <div className="contacts-erp-loading">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="contacts-erp-skeleton-row" />
                ))}
              </div>
            )}
            {errored && (
              <div className="contacts-erp-empty">
                <strong>تعذر تحميل المنتجات</strong>
                <button type="button" className="contacts-erp-btn" onClick={() => void products.refetch()}>إعادة المحاولة</button>
              </div>
            )}
            {!loading && !errored && total === 0 && (
              <div className="contacts-erp-empty">
                <strong>لا توجد منتجات مطابقة</strong>
                {visibilityFilter !== "all" && (
                  <button type="button" className="contacts-erp-btn" onClick={() => setVisibilityFilter("all")}>إلغاء فلتر الحالة</button>
                )}
              </div>
            )}

            {total > 0 && !loading && (
              <>
                <div className="catalog-mobile-cards" aria-label="قائمة المنتجات للهاتف">
                  {pageRows.map((item) => {
                    const visibility = catalogWhatsAppVisibility(item, visibilityScope);
                    const short = catalogVisibilityShortLabel(visibility.status);
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
                            <img src={item.image_url} alt="" className="catalog-thumb" loading="lazy" />
                          ) : (
                            <span className="catalog-thumb placeholder">{item.product_type === "service" ? "س" : "م"}</span>
                          )}
                          <div className="catalog-mobile-copy">
                            <strong className="catalog-product-name">{item.name}</strong>
                            {item.sku && <small className="catalog-product-sku" dir="ltr">{item.sku}</small>}
                            <span className={`catalog-visibility-pill ${visibility.className}`}>{short}</span>
                            <span className="catalog-mobile-price">{catalogPriceLabel(item)}</span>
                            {visibility.status === "broken" && (
                              <>
                                <small className="catalog-visibility-reason">{visibility.reason}</small>
                                <span className="catalog-solution-link">عرض الحل</span>
                              </>
                            )}
                          </div>
                        </button>
                        {renderRowMenu(item)}
                      </article>
                    );
                  })}
                </div>

                <table className="contacts-erp-table contacts-erp-table-filter-headers catalog-erp-table catalog-desktop-table">
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
                      <th className="catalog-col-product">المنتج</th>
                      <th className="catalog-col-status">حالة واتساب</th>
                      <th className="catalog-col-price">السعر</th>
                      {showBranchColumn && <th className="catalog-col-branch">الفرع</th>}
                      <th className="catalog-col-updated">آخر تحديث</th>
                      <th className="catalog-col-actions">
                        <span className="sr-only">إجراءات</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((item) => {
                      const visibility = catalogWhatsAppVisibility(item, visibilityScope);
                      const short = catalogVisibilityShortLabel(visibility.status);
                      const update = formatUpdateCell(item);
                      const showSolution = solutionProductId === item.id;
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
                          <td className="catalog-col-product">
                            <button type="button" className="catalog-product-cell" onClick={() => openDetail(item)}>
                              {item.image_url ? (
                                <img src={item.image_url} alt="" className="catalog-thumb" loading="lazy" />
                              ) : (
                                <span className="catalog-thumb placeholder">{item.product_type === "service" ? "س" : "م"}</span>
                              )}
                              <span className="catalog-product-text">
                                <strong className="catalog-product-name" title={item.name}>{item.name}</strong>
                                {item.sku && <small className="catalog-product-sku" dir="ltr">{item.sku}</small>}
                                {formatCatalogVariantLabel(item) && (
                                  <small className="catalog-table-variant">{formatCatalogVariantLabel(item)}</small>
                                )}
                              </span>
                            </button>
                          </td>
                          <td className="catalog-col-status">
                            <span className={`catalog-visibility-pill ${visibility.className}`} title={visibility.reason}>
                              {short}
                            </span>
                            {visibility.status === "broken" && (
                              <div className="catalog-inline-issue">
                                <small className="catalog-visibility-reason">{visibility.reason}</small>
                                <button
                                  type="button"
                                  className="catalog-solution-link"
                                  onClick={() => setSolutionProductId(showSolution ? null : item.id)}
                                >
                                  عرض الحل
                                </button>
                                {showSolution && (
                                  <small className="catalog-visibility-next">{visibility.nextStep}</small>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="catalog-col-price" dir="ltr">{catalogPriceLabel(item)}</td>
                          {showBranchColumn && (
                            <td className="catalog-col-branch">
                              {item.organization_id && orgMap.has(item.organization_id) ? orgMap.get(item.organization_id) : "—"}
                            </td>
                          )}
                          <td className="catalog-col-updated">
                            <div className="catalog-last-update" title={update.full || undefined}>
                              <span>{update.label}</span>
                              <small>{update.short}</small>
                            </div>
                          </td>
                          <td className="catalog-col-actions">{renderRowMenu(item)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="catalog-pagination-bar">
                  <span>
                    {total === 0
                      ? "0 منتج"
                      : pageSize === 0
                        ? `${total.toLocaleString("ar")} منتج`
                        : `${pageStart}-${pageEnd} من ${total.toLocaleString("ar")} · صفحة ${safePage}/${totalPages}`}
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
                  <button type="button" disabled={safePage <= 1 || pageSize === 0} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="السابق">‹</button>
                  <button type="button" disabled={safePage >= totalPages || pageSize === 0} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="التالي">›</button>
                </div>
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
                    <dl className="catalog-detail-grid">
                      <div><dt>السعر</dt><dd dir="ltr">{catalogPriceLabel(detailProduct)}</dd></div>
                      <div><dt>النوع</dt><dd>{catalogTypeLabel(detailProduct.product_type)}</dd></div>
                      <div><dt>SKU</dt><dd dir="ltr">{detailProduct.sku || "—"}</dd></div>
                      <div><dt>الصنف</dt><dd>{detailProduct.category || "—"}</dd></div>
                      <div>
                        <dt>الفرع</dt>
                        <dd>{detailProduct.organization_id && orgMap.has(detailProduct.organization_id) ? orgMap.get(detailProduct.organization_id) : "—"}</dd>
                      </div>
                      <div>
                        <dt>حالة واتساب</dt>
                        <dd>
                          <span className={`catalog-visibility-pill ${visibility.className}`}>
                            {catalogVisibilityShortLabel(visibility.status)}
                          </span>
                        </dd>
                      </div>
                      <div><dt>السبب</dt><dd>{visibility.reason}</dd></div>
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
                        </dd>
                      </div>
                    </dl>
                    <div className="catalog-detail-actions">
                      <button type="button" className="contacts-erp-btn contacts-erp-btn-primary" onClick={() => openEdit(detailProduct)}>تعديل</button>
                      <button type="button" className="contacts-erp-btn" onClick={closeDetail}>رجوع للقائمة</button>
                    </div>
                  </div>
                );
              })()}
            </aside>
          )}
        </div>
      </section>

      {editingProduct && !isDemo && (
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
                organizations={orgList}
                whatsappAccounts={waList}
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
