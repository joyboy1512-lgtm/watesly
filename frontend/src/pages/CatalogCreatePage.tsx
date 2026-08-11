import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CatalogMetaProductWizard from "../components/CatalogMetaProductWizard";
import CatalogProductFormFields from "../components/CatalogProductFormFields";
import {
  buildMetaGroupPayload,
  buildProductPayload,
  catalogMetaAutoSyncMessage,
  emptyMetaGroupForm,
  emptyProductForm,
  metaGroupReady,
  metaGroupSyncMessages,
  slugifyMetaGroupId,
  type MetaGroupResponse,
  type ProductFormState
} from "../lib/catalogHelpers";
import { uploadFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };
type CreateMode = "meta" | "single";

export default function CatalogCreatePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<CreateMode>("meta");
  const [saving, setSaving] = useState(false);
  const [metaForm, setMetaForm] = useState(emptyMetaGroupForm);
  const [singleForm, setSingleForm] = useState<ProductFormState>(emptyProductForm);
  const [specKey, setSpecKey] = useState("");
  const [specValue, setSpecValue] = useState("");
  const [variantSpecKey, setVariantSpecKey] = useState("");
  const [variantSpecValue, setVariantSpecValue] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [importOrganizationId, setImportOrganizationId] = useState("");

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const categories = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => (await api.get<string[]>("/catalog/categories")).data
  });

  const variantGroups = useQuery({
    queryKey: ["catalog-variant-groups"],
    queryFn: async () => (await api.get<string[]>("/catalog/variant-groups")).data
  });

  useEffect(() => {
    const presetCategory = searchParams.get("category")?.trim();
    if (!presetCategory) return;
    setMetaForm((current) => ({ ...current, category: presetCategory }));
    setSingleForm((current) => ({ ...current, category: presetCategory }));
  }, [searchParams]);

  useEffect(() => {
    const orgs = organizations.data ?? [];
    if (orgs.length !== 1) return;
    setMetaForm((current) => (current.organizationId ? current : { ...current, organizationId: orgs[0].id }));
    setSingleForm((current) => (current.organizationId ? current : { ...current, organizationId: orgs[0].id }));
  }, [organizations.data]);

  useEffect(() => {
    if (mode !== "meta") return;
    if (metaForm.metaItemGroupId.trim()) return;
    const slug = slugifyMetaGroupId(metaForm.baseName);
    if (!slug) return;
    setMetaForm((current) => ({ ...current, metaItemGroupId: slug }));
  }, [metaForm.baseName, metaForm.metaItemGroupId, mode]);

  function addSpec() {
    if (!specKey.trim()) return;
    setSingleForm((current) => ({
      ...current,
      specs: { ...current.specs, [specKey.trim()]: specValue.trim() }
    }));
    setSpecKey("");
    setSpecValue("");
  }

  function removeSpec(key: string) {
    setSingleForm((current) => {
      const next = { ...current.specs };
      delete next[key];
      return { ...current, specs: next };
    });
  }

  function addVariantSpec() {
    if (!variantSpecKey.trim()) return;
    setSingleForm((current) => ({
      ...current,
      variantAttributes: {
        ...current.variantAttributes,
        [variantSpecKey.trim()]: variantSpecValue.trim()
      }
    }));
    setVariantSpecKey("");
    setVariantSpecValue("");
  }

  function removeVariantSpec(key: string) {
    setSingleForm((current) => {
      const next = { ...current.variantAttributes };
      delete next[key];
      return { ...current, variantAttributes: next };
    });
  }

  async function uploadProductImage(file: File) {
    if (!file.type.startsWith("image/")) {
      toastStore.getState().show("اختر صورة فقط.", "error");
      return;
    }
    setUploadingImage(true);
    try {
      const uploaded = await uploadFile(file);
      setSingleForm((current) => ({ ...current, imageUrl: uploaded.public_url }));
      toastStore.getState().show("تم رفع الصورة.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploadingImage(false);
    }
  }

  async function saveMetaGroup() {
    if (!metaGroupReady(metaForm)) {
      toastStore.getState().show("أكمل الحقول المطلوبة لكل النسخ.", "error");
      return;
    }
    setSaving(true);
    try {
      const response = await api.post<MetaGroupResponse>("/catalog/meta-group", buildMetaGroupPayload(metaForm));
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      await client.invalidateQueries({ queryKey: ["catalog-variant-groups"] });
      toastStore.getState().show(`تم حفظ ${response.data.variants.length} نسخة في المجموعة.`, "success");
      for (const message of metaGroupSyncMessages(response.data)) {
        toastStore.getState().show(message, message.includes("رفض") || message.includes("تعذر") ? "error" : "success");
      }
      navigate("/catalog", { replace: true });
    } catch (error: unknown) {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
          ? (error as { response: { data: { detail: string } } }).response.data.detail
          : null;
      toastStore.getState().show(detail ?? "تعذر حفظ المجموعة.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function createSingleProduct(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.post("/catalog", buildProductPayload(singleForm));
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      await client.invalidateQueries({ queryKey: ["catalog-variant-groups"] });
      toastStore.getState().show("تم إضافة المنتج/الخدمة.", "success");
      const metaMessage = catalogMetaAutoSyncMessage(response.data);
      if (metaMessage) {
        toastStore.getState().show(
          metaMessage,
          response.data.meta_review_status === "rejected" || response.data.meta_sync_status === "failed"
            ? "error"
            : "success"
        );
      }
      navigate("/catalog", { replace: true });
    } catch (error: unknown) {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
          ? (error as { response: { data: { detail: string } } }).response.data.detail
          : null;
      toastStore.getState().show(detail ?? "تعذر الحفظ.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function importCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = new FormData(event.currentTarget);
    if (importOrganizationId) {
      payload.set("organization_id", importOrganizationId);
    }
    try {
      const result = await api.post("/catalog/import", payload, { headers: { "Content-Type": "multipart/form-data" } });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      await client.invalidateQueries({ queryKey: ["catalog-variant-groups"] });
      toastStore.getState().show(`تم استيراد ${result.data.created} منتج/خدمة (${result.data.skipped} تم تخطيه).`, "success");
      event.currentTarget.reset();
      navigate("/catalog", { replace: true });
    } catch {
      toastStore.getState().show("تعذر استيراد الملف. استخدم Excel (.xlsx) أو CSV.", "error");
    }
  }

  const singleReady = Boolean(singleForm.name.trim()) && (singleForm.priceType === "quote" || singleForm.price.trim());
  const metaReady = metaGroupReady(metaForm);

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/catalog" className="contacts-back-link">← المنتجات والخدمات</Link>
            <h1>إنشاء منتج Meta</h1>
          </div>
          <div className="contacts-form-topbar-actions">
            {mode === "meta" ? (
              <button
                type="button"
                className="contacts-erp-btn contacts-erp-btn-primary"
                disabled={!metaReady || saving}
                onClick={() => void saveMetaGroup()}
              >
                {saving ? "جاري الحفظ…" : "حفظ المجموعة"}
              </button>
            ) : (
              <button
                type="submit"
                form="catalog-single-form"
                className="contacts-erp-btn contacts-erp-btn-primary"
                disabled={!singleReady || saving}
              >
                {saving ? "جاري الحفظ…" : "حفظ"}
              </button>
            )}
            <Link to="/catalog" className="contacts-erp-btn">إلغاء</Link>
          </div>
        </header>

        <div className="catalog-create-mode-tabs">
          <button type="button" className={mode === "meta" ? "active tone-meta" : ""} onClick={() => setMode("meta")}>
            Meta — نسخ متعددة
          </button>
          <button type="button" className={mode === "single" ? "active tone-single" : ""} onClick={() => setMode("single")}>
            منتج واحد
          </button>
        </div>

        <div className="catalog-create-shell">
          <div className="catalog-create-main">
            {mode === "meta" ? (
              <CatalogMetaProductWizard
                form={metaForm}
                setForm={setMetaForm}
                organizations={organizations.data ?? []}
                categories={categories.data ?? []}
                variantGroups={variantGroups.data ?? []}
                onSubmit={() => void saveMetaGroup()}
                saving={saving}
              />
            ) : (
              <section className="catalog-wizard-section-card tone-single">
                <header className="catalog-wizard-section-header">
                  <div className="catalog-wizard-section-header-text">
                    <h2>منتج أو خدمة واحدة</h2>
                    <p>للمنتجات البسيطة بدون نسخ متعددة</p>
                  </div>
                </header>
                <form id="catalog-single-form" className="catalog-wizard-section-body stack-form" onSubmit={(e) => void createSingleProduct(e)}>
                  <CatalogProductFormFields
                    form={singleForm}
                    setForm={setSingleForm}
                    organizations={organizations.data ?? []}
                    categories={categories.data ?? []}
                    variantGroups={variantGroups.data ?? []}
                    specKey={specKey}
                    setSpecKey={setSpecKey}
                    specValue={specValue}
                    setSpecValue={setSpecValue}
                    onAddSpec={addSpec}
                    onRemoveSpec={removeSpec}
                    variantSpecKey={variantSpecKey}
                    setVariantSpecKey={setVariantSpecKey}
                    variantSpecValue={variantSpecValue}
                    setVariantSpecValue={setVariantSpecValue}
                    onAddVariantSpec={addVariantSpec}
                    onRemoveVariantSpec={removeVariantSpec}
                    uploadingImage={uploadingImage}
                    onUploadImage={(file) => void uploadProductImage(file)}
                  />
                </form>
              </section>
            )}
          </div>

          <aside className="catalog-create-aside">
            <section className="catalog-wizard-section-card tone-import">
              <header className="catalog-wizard-section-header">
                <div className="catalog-wizard-section-header-text">
                  <h2>استيراد من Excel</h2>
                  <p>إضافة عدة منتجات دفعة واحدة</p>
                </div>
              </header>
              <form className="catalog-wizard-section-body stack-form" onSubmit={(e) => void importCatalog(e)}>
                <label className="field-label">
                  <span>الفرع (اختياري)</span>
                  <select value={importOrganizationId} onChange={(e) => setImportOrganizationId(e.target.value)}>
                    <option value="">كل الفروع</option>
                    {(organizations.data ?? []).map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  <span>ملف Excel أو CSV</span>
                  <input name="file" type="file" accept=".xlsx,.xlsm,.csv,text/csv" required />
                </label>
                <p className="hint-text catalog-import-hint">
                  الأعمدة: name · sku · price · meta_item_group_id · variant_size · variant_color · category · image_url
                </p>
                <button type="submit" className="contacts-erp-btn contacts-erp-btn-primary">استيراد المنتجات</button>
              </form>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
