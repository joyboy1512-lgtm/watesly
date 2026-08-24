import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CatalogMetaProductWizard from "../components/CatalogMetaProductWizard";
import CatalogOfferWizard from "../components/CatalogOfferWizard";
import CatalogSimpleProductForm from "../components/CatalogSimpleProductForm";
import {
  buildMetaGroupPayload,
  buildOfferGroupPayload,
  buildSimpleProductPayload,
  catalogMetaAutoSyncMessage,
  emptyMetaGroupForm,
  emptyOfferGroupForm,
  emptyProductForm,
  metaGroupReady,
  metaGroupSyncMessages,
  offerGroupReady,
  slugifyMetaGroupId,
  simpleProductFormReady,
  type MetaGroupResponse,
  type ProductFormState
} from "../lib/catalogHelpers";
import { uploadFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";
import { type WhatsAppAccountRow } from "../lib/whatsappHelpers";

type Organization = { id: string; name: string };
type CreateMode = "single" | "offer" | "meta";

function isOfferCategoryName(value: string) {
  return /عرض/i.test(value.trim());
}

export default function CatalogCreatePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<CreateMode>(() => {
    const requestedMode = searchParams.get("mode")?.trim();
    if (requestedMode === "offer" || requestedMode === "meta" || requestedMode === "single") {
      return requestedMode;
    }
    const presetCategory = searchParams.get("category")?.trim();
    return presetCategory && isOfferCategoryName(presetCategory) ? "offer" : "single";
  });
  const [saving, setSaving] = useState(false);
  const [metaForm, setMetaForm] = useState(emptyMetaGroupForm);
  const [offerForm, setOfferForm] = useState(emptyOfferGroupForm);
  const [singleForm, setSingleForm] = useState<ProductFormState>(emptyProductForm);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [importOrganizationId, setImportOrganizationId] = useState("");
  const [importChannelId, setImportChannelId] = useState("");

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

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });

  const whatsappAccountCount = whatsappAccounts.data?.length ?? 0;

  useEffect(() => {
    const presetCategory = searchParams.get("category")?.trim();
    if (!presetCategory) return;
    setMetaForm((current) => ({ ...current, category: presetCategory }));
    setOfferForm((current) => ({
      ...current,
      category: isOfferCategoryName(presetCategory) ? presetCategory : current.category || "عروض"
    }));
  }, [searchParams]);

  useEffect(() => {
    const orgs = organizations.data ?? [];
    if (orgs.length !== 1) return;
    setMetaForm((current) => (current.organizationId ? current : { ...current, organizationId: orgs[0].id }));
    setOfferForm((current) => (current.organizationId ? current : { ...current, organizationId: orgs[0].id }));
    setSingleForm((current) => (current.organizationId ? current : { ...current, organizationId: orgs[0].id }));
  }, [organizations.data]);

  useEffect(() => {
    const accounts = whatsappAccounts.data ?? [];
    if (accounts.length !== 1) return;
    const only = accounts[0];
    setMetaForm((current) =>
      current.channelId
        ? current
        : { ...current, channelId: only.channel_id, organizationId: only.organization_id ?? current.organizationId }
    );
    setOfferForm((current) =>
      current.channelId
        ? current
        : { ...current, channelId: only.channel_id, organizationId: only.organization_id ?? current.organizationId }
    );
    setSingleForm((current) =>
      current.channelId
        ? current
        : { ...current, channelId: only.channel_id, organizationId: only.organization_id ?? current.organizationId }
    );
    setImportChannelId((current) => current || only.channel_id);
  }, [whatsappAccounts.data]);

  useEffect(() => {
    if (mode !== "meta" && mode !== "offer") return;
    const activeForm = mode === "offer" ? offerForm : metaForm;
    if (activeForm.metaItemGroupId.trim()) return;
    const slug = slugifyMetaGroupId(activeForm.baseName);
    if (!slug) return;
    if (mode === "offer") {
      setOfferForm((current) => ({ ...current, metaItemGroupId: slug }));
      return;
    }
    setMetaForm((current) => ({ ...current, metaItemGroupId: slug }));
  }, [metaForm.baseName, metaForm.metaItemGroupId, mode, offerForm.baseName, offerForm.metaItemGroupId]);

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
    if (!metaGroupReady(metaForm, whatsappAccountCount)) {
      toastStore.getState().show("أكمل الحقول المطلوبة — بما فيها قناة WhatsApp.", "error");
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

  async function saveOfferGroup() {
    if (!offerGroupReady(offerForm, whatsappAccountCount)) {
      toastStore.getState().show("أكمل: اسم العرض، القناة، الباقات الفرعية، الصور، والأسعار.", "error");
      return;
    }
    setSaving(true);
    try {
      const response = await api.post<MetaGroupResponse>("/catalog/meta-group", buildOfferGroupPayload(offerForm));
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      await client.invalidateQueries({ queryKey: ["catalog-variant-groups"] });
      toastStore.getState().show(`تم حفظ ${response.data.variants.length} عرض فرعي.`, "success");
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
      toastStore.getState().show(detail ?? "تعذر حفظ العرض.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function createSingleProduct(event: FormEvent) {
    event.preventDefault();
    if (!simpleProductFormReady(singleForm, organizations.data?.length ?? 1, whatsappAccountCount)) {
      toastStore.getState().show("أكمل: القناة، الاسم، السعر، والصورة.", "error");
      return;
    }
    const orgs = organizations.data ?? [];
    if (orgs.length > 1 && !singleForm.organizationId) {
      toastStore.getState().show("اختر الفرع — كل فرع له كتالوج WhatsApp منفصل.", "error");
      return;
    }
    setSaving(true);
    try {
      const response = await api.post("/catalog", buildSimpleProductPayload(singleForm));
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-categories"] });
      toastStore.getState().show("تم إضافة المنتج.", "success");
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
    if (!importChannelId) {
      toastStore.getState().show("اختر قناة WhatsApp للاستيراد.", "error");
      return;
    }
    payload.set("channel_id", importChannelId);
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

  const singleReady = simpleProductFormReady(singleForm, organizations.data?.length ?? 1, whatsappAccountCount);
  const metaReady = metaGroupReady(metaForm, whatsappAccountCount);
  const offerReady = offerGroupReady(offerForm, whatsappAccountCount);
  const pageTitle =
    mode === "single" ? "إضافة منتج" : mode === "offer" ? "إنشاء عرض" : "منتجات متعددة (Meta)";

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/catalog" className="contacts-back-link">← المنتجات والخدمات</Link>
            <h1>{pageTitle}</h1>
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
            ) : mode === "offer" ? (
              <button
                type="button"
                className="contacts-erp-btn contacts-erp-btn-primary"
                disabled={!offerReady || saving}
                onClick={() => void saveOfferGroup()}
              >
                {saving ? "جاري الحفظ…" : "حفظ العرض"}
              </button>
            ) : (
              <button
                type="submit"
                form="catalog-single-form"
                className="contacts-erp-btn contacts-erp-btn-primary"
                disabled={!singleReady || saving}
              >
                {saving ? "جاري الحفظ…" : "حفظ ومزامنة"}
              </button>
            )}
            <Link to="/catalog" className="contacts-erp-btn">إلغاء</Link>
          </div>
        </header>

        <div className="catalog-create-mode-tabs">
          <button type="button" className={mode === "single" ? "active tone-single" : ""} onClick={() => setMode("single")}>
            منتج واحد
          </button>
          <button type="button" className={mode === "offer" ? "active tone-offer" : ""} onClick={() => setMode("offer")}>
            عرض + عروض فرعية
          </button>
          <button type="button" className={mode === "meta" ? "active tone-meta" : ""} onClick={() => setMode("meta")}>
            نسخ متعددة (Meta)
          </button>
        </div>

        <div className="catalog-create-shell">
          <div className="catalog-create-main">
            {mode === "offer" ? (
              <CatalogOfferWizard
                form={offerForm}
                setForm={setOfferForm}
                organizations={organizations.data ?? []}
                whatsappAccounts={whatsappAccounts.data ?? []}
                categories={categories.data ?? []}
                variantGroups={variantGroups.data ?? []}
                onSubmit={() => void saveOfferGroup()}
                saving={saving}
              />
            ) : mode === "meta" ? (
              <CatalogMetaProductWizard
                form={metaForm}
                setForm={setMetaForm}
                organizations={organizations.data ?? []}
                whatsappAccounts={whatsappAccounts.data ?? []}
                categories={categories.data ?? []}
                variantGroups={variantGroups.data ?? []}
                onSubmit={() => void saveMetaGroup()}
                saving={saving}
              />
            ) : (
              <section className="catalog-wizard-section-card tone-single catalog-simple-card">
                <header className="catalog-wizard-section-header">
                  <div className="catalog-wizard-section-header-text">
                    <h2>بيانات Meta الأساسية</h2>
                    <p>الصورة، الاسم، السعر، والوصف — كل ما يحتاجه كتالوج WhatsApp.</p>
                  </div>
                </header>
                <form id="catalog-single-form" className="catalog-wizard-section-body" onSubmit={(e) => void createSingleProduct(e)}>
                  <CatalogSimpleProductForm
                    form={singleForm}
                    setForm={setSingleForm}
                    organizations={organizations.data ?? []}
                    whatsappAccounts={whatsappAccounts.data ?? []}
                    uploadingImage={uploadingImage}
                    onUploadImage={(file) => void uploadProductImage(file)}
                  />
                </form>
              </section>
            )}
          </div>

          {mode === "single" && (
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
                    <span>قناة WhatsApp *</span>
                    <select value={importChannelId} onChange={(e) => setImportChannelId(e.target.value)} required>
                      <option value="">— اختر القناة —</option>
                      {(whatsappAccounts.data ?? []).map((account) => (
                        <option key={account.channel_id} value={account.channel_id}>
                          {account.verified_name || account.display_phone_number || account.channel_name}
                        </option>
                      ))}
                    </select>
                  </label>
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
                  <p className="hint-text catalog-import-hint">الأعمدة: name · price · image_url · sku</p>
                  <button type="submit" className="contacts-erp-btn contacts-erp-btn-primary">استيراد</button>
                </form>
              </section>
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}
