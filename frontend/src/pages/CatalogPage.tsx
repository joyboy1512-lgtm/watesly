import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CatalogProductFormFields from "../components/CatalogProductFormFields";
import Icon from "../components/Icon";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import {
  buildProductPayload,
  catalogMetaStatusLabel,
  catalogPriceLabel,
  catalogTypeLabel,
  downloadCatalogExport,
  emptyProductForm,
  filterCatalogByType,
  productFormFromCatalog,
  sortCatalogProducts,
  type CatalogListTab,
  type CatalogProduct,
  type CatalogReplyPreview,
  type CatalogTypeFilter,
  type ProductFormState
} from "../lib/catalogHelpers";
import { uploadFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };

const PAGE_SIZE = 25;

export default function CatalogPage() {
  const client = useQueryClient();

  const [listTab, setListTab] = useState<CatalogListTab>("active");
  const [typeFilter, setTypeFilter] = useState<CatalogTypeFilter>("all");
  const [filterOrganizationId, setFilterOrganizationId] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showPreview, setShowPreview] = useState(false);

  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [editForm, setEditForm] = useState<ProductFormState>(emptyProductForm);
  const [editSpecKey, setEditSpecKey] = useState("");
  const [editSpecValue, setEditSpecValue] = useState("");
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

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [listTab, typeFilter, filterOrganizationId, filterCategory, debouncedSearch]);

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations.data ?? []) {
      map.set(org.id, org.name);
    }
    return map;
  }, [organizations.data]);

  const products = useQuery({
    queryKey: ["catalog", listTab, filterOrganizationId, filterCategory, debouncedSearch] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (listTab === "inactive") params.set("include_inactive", "true");
      if (filterOrganizationId) params.set("organization_id", filterOrganizationId);
      if (filterCategory) params.set("category", filterCategory);

      if (debouncedSearch) {
        params.set("q", debouncedSearch);
        params.set("limit", "500");
        const result = await api.get<CatalogProduct[]>(`/catalog/search?${params.toString()}`);
        return result.data;
      }

      const result = await api.get<CatalogProduct[]>(`/catalog?${params.toString()}`);
      return result.data;
    }
  });

  const visibleProducts = useMemo(() => {
    const rows = products.data ?? [];
    const byTab = listTab === "inactive" ? rows.filter((item) => !item.is_active) : rows.filter((item) => item.is_active);
    return sortCatalogProducts(filterCatalogByType(byTab, typeFilter));
  }, [products.data, listTab, typeFilter]);

  const total = visibleProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(safePage * PAGE_SIZE, total);
  const pageRows = visibleProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function addEditSpec() {
    if (!editSpecKey.trim()) return;
    setEditForm((current) => ({
      ...current,
      specs: { ...current.specs, [editSpecKey.trim()]: editSpecValue.trim() }
    }));
    setEditSpecKey("");
    setEditSpecValue("");
  }

  function removeEditSpec(key: string) {
    setEditForm((current) => {
      const next = { ...current.specs };
      delete next[key];
      return { ...current, specs: next };
    });
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingProduct) return;
    try {
      await api.patch(`/catalog/${editingProduct.id}`, buildProductPayload(editForm));
      setEditingProduct(null);
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      toastStore.getState().show("تم تحديث المنتج.", "success");
    } catch {
      toastStore.getState().show("تعذر التحديث.", "error");
    }
  }

  async function deactivateProduct(id: string) {
    await api.delete(`/catalog/${id}`);
    await client.invalidateQueries({ queryKey: ["catalog"] });
    toastStore.getState().show("تم أرشفة المنتج.", "success");
  }

  async function restoreProduct(id: string) {
    await api.patch(`/catalog/${id}`, { is_active: true });
    await client.invalidateQueries({ queryKey: ["catalog"] });
    toastStore.getState().show("تم استرجاع المنتج.", "success");
  }

  function openEdit(product: CatalogProduct) {
    setEditingProduct(product);
    setEditForm(productFormFromCatalog(product));
    setEditSpecKey("");
    setEditSpecValue("");
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
      }>(`/catalog/${product.id}/sync-meta`);
      await client.invalidateQueries({ queryKey: ["catalog"] });
      const { synced, failed, pending = 0, approved = 0 } = result.data;
      if (synced > 0) {
        toastStore.getState().show(
          `تمت مزامنة «${product.name}» — معتمد ${approved}، قيد المراجعة ${pending}.`,
          "success"
        );
      } else {
        toastStore.getState().show("تعذر مزامنة المنتج مع Meta.", "error");
      }
      if (failed > 0) {
        toastStore.getState().show("فشلت مزامنة المنتج مع Meta.", "error");
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
    try {
      await downloadCatalogExport({ includeInactive: listTab === "inactive", format: "xlsx" });
      toastStore.getState().show("تم تصدير المنتجات إلى Excel.", "success");
    } catch {
      toastStore.getState().show("تعذر التصدير.", "error");
    }
  }

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell">
        <header className="contacts-erp-header">
          <div className="contacts-erp-title-block">
            <span className="contacts-erp-eyebrow">كتalog الشركة</span>
            <h1>المنتجات والخدمات</h1>
            <p className="hint-text">إدارة المنتجات والخدمات — الذكاء الاصطناعي يرد على عملاء WhatsApp من هذه القائمة.</p>
          </div>
        </header>

        <div className="contacts-erp-toolbar">
          <div className="contacts-erp-actions">
            <Link to="/catalog/new" className="contacts-erp-btn contacts-erp-btn-primary">
              إنشاء منتج
            </Link>
            <Link to="/catalog/category/new" className="contacts-erp-btn">
              إنشاء صنف
            </Link>
            <button type="button" className="contacts-erp-btn" onClick={() => void prepareCommerceIds()}>
              تجهيز Meta IDs
            </button>
            <button
              type="button"
              className="contacts-erp-btn"
              disabled={refreshingMetaStatus}
              onClick={() => void refreshMetaStatus()}
            >
              {refreshingMetaStatus ? "جاري التحديث…" : "تحديث حالة Meta"}
            </button>
            <button type="button" className="contacts-erp-btn contacts-erp-btn-icon" onClick={() => void exportCatalog()} title="تصدير Excel">
              ⬇ Excel
            </button>
            <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={() => setShowPreview((value) => !value)}>
              {showPreview ? "إخفاء المعاينة" : "معاينة WhatsApp"}
            </button>
          </div>

          <div className="contacts-erp-meta">
            <div className="catalog-filter-tabs catalog-filter-tabs-inline">
              <button
                type="button"
                className={listTab === "active" ? "active" : ""}
                onClick={() => setListTab("active")}
              >
                نشطة
              </button>
              <button
                type="button"
                className={listTab === "inactive" ? "active" : ""}
                onClick={() => setListTab("inactive")}
              >
                مؤرشفة
              </button>
            </div>
            <select
              value={filterOrganizationId}
              onChange={(e) => setFilterOrganizationId(e.target.value)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب الفرع"
            >
              <option value="">كل الفروع</option>
              {(organizations.data ?? []).map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
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
              <span>{total === 0 ? "0 / 0" : `${pageStart}-${pageEnd} / ${total}`}</span>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="السابق">
                ‹
              </button>
              <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="التالي">
                ›
              </button>
            </div>
          </div>
        </div>

        <div className="contacts-erp-table-wrap">
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
              <strong>لا توجد منتجات أو خدمات</strong>
              <p>ابدأ بإنشاء منتج أو صنف جديد.</p>
              <div className="contacts-erp-actions">
                <Link to="/catalog/new" className="contacts-erp-btn contacts-erp-btn-primary">إنشاء منتج</Link>
                <Link to="/catalog/category/new" className="contacts-erp-btn">إنشاء صنف</Link>
              </div>
            </div>
          )}

          {total > 0 && !products.isLoading && (
            <table className="contacts-erp-table catalog-erp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الصورة</th>
                  <th>الاسم</th>
                  <th>SKU</th>
                  <th>النوع</th>
                  <th>الصنف</th>
                  <th>السعر</th>
                  <th>الفرع</th>
                  <th>الترتيب</th>
                  <th>الاستخدام</th>
                  <th>Meta</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item, index) => (
                  <tr key={item.id} className={item.is_active ? "" : "catalog-row-inactive"}>
                    <td>{pageStart + index}</td>
                    <td>
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="catalog-table-thumb" loading="lazy" />
                      ) : (
                        <span className="catalog-table-thumb placeholder">{item.product_type === "service" ? "🛠" : "📦"}</span>
                      )}
                    </td>
                    <td>
                      <strong>{item.name}</strong>
                      {item.description && <small className="catalog-table-desc">{item.description}</small>}
                    </td>
                    <td><code>{item.sku || "—"}</code></td>
                    <td><span className={`catalog-type-badge ${item.product_type}`}>{catalogTypeLabel(item.product_type)}</span></td>
                    <td>{item.category || "—"}</td>
                    <td>{catalogPriceLabel(item)}</td>
                    <td>{item.organization_id && orgMap.has(item.organization_id) ? orgMap.get(item.organization_id) : "—"}</td>
                    <td>{item.sort_order ?? 0}</td>
                    <td>{item.usage_count > 0 ? item.usage_count : "—"}</td>
                    <td>
                      {(() => {
                        const metaStatus = catalogMetaStatusLabel(item);
                        return (
                          <div className="catalog-meta-status-cell">
                            <span className={`catalog-meta-status-pill ${metaStatus.className}`}>
                              {metaStatus.label}
                            </span>
                            {metaStatus.detail && (
                              <small className="hint-text catalog-meta-status-detail">{metaStatus.detail}</small>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span className={`catalog-status-pill ${item.is_active ? "active" : "archived"}`}>
                        {item.is_active ? "نشط" : "مؤرشف"}
                      </span>
                    </td>
                    <td>
                      <div className="catalog-table-actions">
                        <button type="button" className="contacts-erp-btn" onClick={() => openEdit(item)}>تعديل</button>
                        {item.is_active && item.meta_sync_enabled !== false && (
                          <button
                            type="button"
                            className="contacts-erp-btn"
                            disabled={syncingProductId === item.id}
                            onClick={() => void syncProductToMeta(item)}
                          >
                            {syncingProductId === item.id ? "جاري…" : "مزامنة Meta"}
                          </button>
                        )}
                        {item.is_active && (
                          <button
                            type="button"
                            className="contacts-erp-btn"
                            onClick={() => void toggleMetaSync(item)}
                          >
                            {item.meta_sync_enabled === false ? "تفعيل Meta" : "إيقاف Meta"}
                          </button>
                        )}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showPreview && (
        <section className="card catalog-preview-card">
          <h2 className="section-title">معاينة رد WhatsApp</h2>
          <p className="hint-text">اكتب استفساراً وشاهد كيف سيظهر الرد للعميل من الكatalog.</p>
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
                  {(previewReply.data?.matched_products ?? []).map((product) => (
                    <article key={product.id} className="catalog-preview-product-chip">
                      {product.image_url ? <img src={product.image_url} alt={product.name} /> : <span>📦</span>}
                      <div>
                        <strong>{product.name}</strong>
                        <small>{product.price_label}</small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {editingProduct && (
        <div className="catalog-edit-overlay" role="dialog" aria-modal="true">
          <button type="button" className="catalog-edit-backdrop" aria-label="إغلاق" onClick={() => setEditingProduct(null)} />
          <form className="catalog-edit-panel stack-form" onSubmit={saveEdit}>
            <div className="catalog-edit-head">
              <h3>تعديل: {editingProduct.name}</h3>
              <button type="button" className="panel-close" onClick={() => setEditingProduct(null)}>×</button>
            </div>
            <CatalogProductFormFields
              form={editForm}
              setForm={setEditForm}
              organizations={organizations.data ?? []}
              categories={categories.data ?? []}
              specKey={editSpecKey}
              setSpecKey={setEditSpecKey}
              specValue={editSpecValue}
              setSpecValue={setEditSpecValue}
              onAddSpec={addEditSpec}
              onRemoveSpec={removeEditSpec}
              uploadingImage={uploadingImage}
              onUploadImage={(file) => void uploadProductImage(file)}
            />
            <div className="catalog-card-actions">
              <button type="submit" className="whatsapp-button">حفظ التعديلات</button>
              <button type="button" className="secondary-button" onClick={() => setEditingProduct(null)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
