import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CatalogProductFormFields from "../components/CatalogProductFormFields";
import {
  buildProductPayload,
  catalogMetaAutoSyncMessage,
  emptyProductForm,
  type CatalogProduct,
  type ProductFormState
} from "../lib/catalogHelpers";
import { uploadFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };

export default function CatalogCreatePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
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
    setForm((current) => ({ ...current, category: presetCategory }));
  }, [searchParams]);

  useEffect(() => {
    const orgs = organizations.data ?? [];
    if (orgs.length !== 1) return;
    setForm((current) => (current.organizationId ? current : { ...current, organizationId: orgs[0].id }));
  }, [organizations.data]);

  function addSpec() {
    if (!specKey.trim()) return;
    setForm((current) => ({
      ...current,
      specs: { ...current.specs, [specKey.trim()]: specValue.trim() }
    }));
    setSpecKey("");
    setSpecValue("");
  }

  function removeSpec(key: string) {
    setForm((current) => {
      const next = { ...current.specs };
      delete next[key];
      return { ...current, specs: next };
    });
  }

  function addVariantSpec() {
    if (!variantSpecKey.trim()) return;
    setForm((current) => ({
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
    setForm((current) => {
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
      setForm((current) => ({ ...current, imageUrl: uploaded.public_url }));
      toastStore.getState().show("تم رفع الصورة.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploadingImage(false);
    }
  }

  async function createProduct(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.post<CatalogProduct>("/catalog", buildProductPayload(form));
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

  const ready = Boolean(form.name.trim()) && (form.priceType === "quote" || form.price.trim());

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/catalog" className="contacts-back-link">← المنتجات والخدمات</Link>
            <h1>إنشاء منتج أو خدمة</h1>
          </div>
          <div className="contacts-form-topbar-actions">
            <button type="submit" form="catalog-create-form" className="contacts-erp-btn contacts-erp-btn-primary" disabled={!ready || saving}>
              {saving ? "جاري الحفظ…" : "حفظ"}
            </button>
            <Link to="/catalog" className="contacts-erp-btn">إلغاء</Link>
          </div>
        </header>

        <div className="catalog-create-layout">
          <form id="catalog-create-form" className="catalog-panel stack-form" onSubmit={(e) => void createProduct(e)}>
            <h2 className="section-title-sm">بيانات المنتج</h2>
            <CatalogProductFormFields
              form={form}
              setForm={setForm}
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

          <form className="catalog-panel stack-form" onSubmit={(e) => void importCatalog(e)}>
            <h2 className="section-title-sm">استيراد من Excel</h2>
            <p className="hint-text">ارفع ملف Excel أو CSV لإضافة عدة منتجات دفعة واحدة.</p>
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
            <p className="hint-text">
              الأعمدة: name · sku · price · meta_item_group_id · variant_size · variant_color · category · specs
            </p>
            <button type="submit" className="contacts-erp-btn">استيراد المنتجات</button>
          </form>
        </div>
      </section>
    </main>
  );
}
