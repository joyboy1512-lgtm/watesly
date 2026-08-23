import { useState, type ReactNode } from "react";
import {
  emptyMetaVariant,
  slugifyMetaGroupId,
  type MetaGroupFormState,
  type MetaVariantFormState
} from "../lib/catalogHelpers";
import { uploadFile } from "../lib/uploads";
import { whatsappAccountLabel } from "../lib/whatsappHelpers";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };

type CatalogMetaProductWizardProps = {
  form: MetaGroupFormState;
  setForm: (updater: (current: MetaGroupFormState) => MetaGroupFormState) => void;
  organizations: Organization[];
  whatsappAccounts: Array<{ channel_id: string; organization_id: string; verified_name?: string | null; display_phone_number?: string; channel_name?: string | null }>;
  categories: string[];
  variantGroups: string[];
  formId?: string;
  onSubmit: () => void;
  saving?: boolean;
};

function WizardSectionCard({
  tone,
  title,
  hint,
  action,
  children
}: {
  tone: "shared" | "variants" | "import" | "single";
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`catalog-wizard-section-card tone-${tone}`}>
      <header className="catalog-wizard-section-header">
        <div className="catalog-wizard-section-header-text">
          <h2>{title}</h2>
          {hint ? <p>{hint}</p> : null}
        </div>
        {action ? <div className="catalog-wizard-section-header-action">{action}</div> : null}
      </header>
      <div className="catalog-wizard-section-body">{children}</div>
    </section>
  );
}

const VARIANT_TONES = ["teal", "blue", "amber", "violet"] as const;

function variantTone(index: number) {
  return VARIANT_TONES[index % VARIANT_TONES.length];
}

function VariantAttributesEditor({
  variant,
  onChange
}: {
  variant: MetaVariantFormState;
  onChange: (next: MetaVariantFormState) => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  function addAttribute() {
    if (!key.trim()) return;
    onChange({
      ...variant,
      variantAttributes: {
        ...variant.variantAttributes,
        [key.trim()]: value.trim()
      }
    });
    setKey("");
    setValue("");
  }

  function removeAttribute(attrKey: string) {
    const next = { ...variant.variantAttributes };
    delete next[attrKey];
    onChange({ ...variant, variantAttributes: next });
  }

  return (
    <div className="catalog-variant-attrs">
      <span className="field-label-title">صفات إضافية (Meta)</span>
      <div className="spec-builder">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="الصفة (النكهة)" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="القيمة (فراولة)" />
        <button type="button" onClick={addAttribute}>+</button>
      </div>
      {Object.keys(variant.variantAttributes).length > 0 && (
        <ul className="spec-list">
          {Object.entries(variant.variantAttributes).map(([attrKey, attrValue]) => (
            <li key={attrKey}>
              <strong>{attrKey}:</strong> {attrValue}
              <button type="button" className="danger-link" onClick={() => removeAttribute(attrKey)}>
                حذف
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CatalogMetaProductWizard({
  form,
  setForm,
  organizations,
  whatsappAccounts,
  categories,
  variantGroups,
  formId = "catalog-meta-wizard",
  onSubmit,
  saving = false
}: CatalogMetaProductWizardProps) {
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  function selectChannel(channelId: string) {
    const account = whatsappAccounts.find((item) => item.channel_id === channelId);
    setForm((current) => ({
      ...current,
      channelId,
      organizationId: account?.organization_id ?? current.organizationId
    }));
  }

  function updateVariant(clientKey: string, patch: Partial<MetaVariantFormState>) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) =>
        variant.clientKey === clientKey ? { ...variant, ...patch } : variant
      )
    }));
  }

  function addVariant() {
    setForm((current) => ({
      ...current,
      variants: [...current.variants, emptyMetaVariant(current.variants.length)]
    }));
  }

  function removeVariant(clientKey: string) {
    setForm((current) => {
      if (current.variants.length <= 1) return current;
      return {
        ...current,
        variants: current.variants.filter((variant) => variant.clientKey !== clientKey)
      };
    });
  }

  async function uploadVariantImage(clientKey: string, file: File) {
    if (!file.type.startsWith("image/")) {
      toastStore.getState().show("اختر صورة فقط.", "error");
      return;
    }
    setUploadingKey(clientKey);
    try {
      const uploaded = await uploadFile(file);
      updateVariant(clientKey, { imageUrl: uploaded.public_url });
      toastStore.getState().show("تم رفع صورة النسخة.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploadingKey(null);
    }
  }

  function autoGroupId() {
    const slug = slugifyMetaGroupId(form.baseName);
    if (!slug) {
      toastStore.getState().show("أدخل اسم المنتج أولاً.", "error");
      return;
    }
    setForm((current) => ({ ...current, metaItemGroupId: slug }));
  }

  return (
    <form
      id={formId}
      className="catalog-meta-wizard stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <WizardSectionCard
        tone="shared"
        title="بيانات المنتج المشتركة"
        hint="تُشارَك بين كل النسخ في كتالوج WhatsApp — نفس item_group_id"
      >
        <div className="catalog-fields-row-fit">
          <label className="field-label catalog-field-w-grow">
            <span>اسم المنتج الأساسي *</span>
            <input
              value={form.baseName}
              onChange={(e) => setForm((current) => ({ ...current, baseName: e.target.value }))}
              placeholder="مثال: جل استحمام Dovey"
              required
            />
          </label>
          <label className="field-label catalog-field-w-type">
            <span>النوع</span>
            <select
              value={form.productType}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  productType: e.target.value as MetaGroupFormState["productType"]
                }))
              }
            >
              <option value="product">منتج</option>
              <option value="service">خدمة</option>
            </select>
          </label>
        </div>

        <div className="catalog-field-with-action">
          <label className="field-label">
            <span>مجموعة المنتج (item_group_id) *</span>
            <input
              value={form.metaItemGroupId}
              onChange={(e) => setForm((current) => ({ ...current, metaItemGroupId: e.target.value }))}
              placeholder="shower-gel-dovey"
              dir="ltr"
              list="catalog-variant-group-suggestions"
              required
            />
          </label>
          <button type="button" className="contacts-erp-btn catalog-field-action-btn" onClick={autoGroupId}>
            توليد من الاسم
          </button>
        </div>

        <div className="catalog-fields-row-fit">
          {whatsappAccounts.length > 1 ? (
            <label className="field-label catalog-field-w-md">
              <span>قناة WhatsApp *</span>
              <select value={form.channelId} onChange={(e) => selectChannel(e.target.value)} required>
                <option value="">— اختر القناة —</option>
                {whatsappAccounts.map((account) => (
                  <option key={account.channel_id} value={account.channel_id}>
                    {whatsappAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
          ) : whatsappAccounts.length === 1 ? (
            <p className="catalog-branch-label catalog-field-w-md">
              <span>قناة WhatsApp</span>
              <strong>{whatsappAccountLabel(whatsappAccounts[0])}</strong>
            </p>
          ) : null}
          <label className="field-label catalog-field-w-md">
            <span>الفرع {organizations.length === 1 ? "" : "(مطلوب)"}</span>
            <select
              value={form.organizationId}
              onChange={(e) => setForm((current) => ({ ...current, organizationId: e.target.value }))}
              required={organizations.length > 1}
            >
              <option value="">{organizations.length === 1 ? "الفرع الافتراضي" : "— اختر الفرع —"}</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </label>
          <label className="field-label catalog-field-w-md">
            <span>الصنف / الفئة</span>
            <input
              value={form.category}
              onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
              placeholder="عناية شخصية…"
              list="catalog-category-suggestions"
            />
          </label>
        </div>

        <label className="field-label">
          <span>الوصف</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
            placeholder="وصف مختصر يظهر للعميل في WhatsApp"
            rows={2}
          />
        </label>

        <div className="catalog-fields-row-fit">
          <label className="field-label catalog-field-w-type">
            <span>نوع السعر</span>
            <select
              value={form.priceType}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  priceType: e.target.value as MetaGroupFormState["priceType"]
                }))
              }
            >
              <option value="fixed">سعر ثابت</option>
              <option value="from">يبدأ من</option>
              <option value="quote">عرض سعر</option>
            </select>
          </label>
          {form.priceType !== "quote" && (
            <label className="field-label catalog-field-w-xs">
              <span>العملة</span>
              <input
                value={form.currency}
                onChange={(e) => setForm((current) => ({ ...current, currency: e.target.value }))}
                placeholder="KWD"
                dir="ltr"
              />
            </label>
          )}
          <label className="catalog-meta-sync-chip">
            <input
              type="checkbox"
              checked={form.metaSyncEnabled}
              onChange={(e) => setForm((current) => ({ ...current, metaSyncEnabled: e.target.checked }))}
            />
            <span>مزامنة Meta</span>
            <span className="catalog-meta-sync-state">{form.metaSyncEnabled ? "مفعّلة" : "موقوفة"}</span>
          </label>
        </div>
      </WizardSectionCard>

      <WizardSectionCard
        tone="variants"
        title="النسخ (Variants)"
        hint="نسخة لكل لون أو مقاس — صورة وسعر وSKU مستقل لكل نسخة"
        action={
          <button type="button" className="contacts-erp-btn catalog-wizard-header-btn" onClick={addVariant}>
            + نسخة جديدة
          </button>
        }
      >
        <div className="catalog-variant-cards">
          {form.variants.map((variant, index) => (
            <article key={variant.clientKey} className={`catalog-variant-card tone-${variantTone(index)}`}>
              <header className="catalog-variant-card-head">
                <div className="catalog-variant-card-title">
                  <span className="catalog-variant-card-badge">{index + 1}</span>
                  <strong>
                    {variant.variantColor.trim() || variant.variantSize.trim()
                      ? [variant.variantColor, variant.variantSize].filter(Boolean).join(" · ")
                      : `النسخة ${index + 1}`}
                  </strong>
                </div>
                {form.variants.length > 1 && (
                  <button
                    type="button"
                    className="catalog-variant-card-remove"
                    onClick={() => removeVariant(variant.clientKey)}
                  >
                    حذف
                  </button>
                )}
              </header>

              <div className="catalog-variant-card-body">
                <div className="catalog-variant-image-row">
                  <div className="catalog-variant-thumb">
                    {variant.imageUrl ? (
                      <img src={variant.imageUrl} alt={`نسخة ${index + 1}`} className="catalog-form-image" />
                    ) : (
                      <div className="catalog-form-image placeholder">—</div>
                    )}
                  </div>
                  <div className="catalog-variant-image-controls">
                    <span className="field-label-title">صورة النسخة</span>
                    <label className="secondary-button compact">
                      {uploadingKey === variant.clientKey ? "جاري الرفع…" : "رفع صورة"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        disabled={uploadingKey === variant.clientKey}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadVariantImage(variant.clientKey, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <input
                      className="catalog-variant-image-url"
                      value={variant.imageUrl}
                      onChange={(e) => updateVariant(variant.clientKey, { imageUrl: e.target.value })}
                      placeholder="رابط الصورة"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="catalog-variant-card-fields">
                  <div className="catalog-fields-row-fit">
                    <label className="field-label catalog-field-w-md">
                      <span>اللون</span>
                      <input
                        value={variant.variantColor}
                        onChange={(e) => updateVariant(variant.clientKey, { variantColor: e.target.value })}
                        placeholder="أبيض"
                      />
                    </label>
                    <label className="field-label catalog-field-w-md">
                      <span>المقاس</span>
                      <input
                        value={variant.variantSize}
                        onChange={(e) => updateVariant(variant.clientKey, { variantSize: e.target.value })}
                        placeholder="400ml"
                      />
                    </label>
                    {form.priceType !== "quote" && (
                      <label className="field-label catalog-field-w-sm">
                        <span>السعر *</span>
                        <input
                          value={variant.price}
                          onChange={(e) => updateVariant(variant.clientKey, { price: e.target.value })}
                          placeholder="0.000"
                          type="number"
                          step="0.001"
                          dir="ltr"
                          required
                        />
                      </label>
                    )}
                  </div>

                  <div className="catalog-fields-row-fit">
                    <label className="field-label catalog-field-w-md">
                      <span>SKU</span>
                      <input
                        value={variant.sku}
                        onChange={(e) => updateVariant(variant.clientKey, { sku: e.target.value })}
                        placeholder="DOVEY-400-WHT"
                        dir="ltr"
                      />
                    </label>
                    <label className="field-label catalog-field-w-md">
                      <span>Meta Retailer ID</span>
                      <input
                        value={variant.metaRetailerId}
                        onChange={(e) => updateVariant(variant.clientKey, { metaRetailerId: e.target.value })}
                        placeholder="يُولَّد من SKU"
                        dir="ltr"
                      />
                    </label>
                    <label className="field-label catalog-field-w-xs">
                      <span>ترتيب</span>
                      <input
                        value={variant.sortOrder}
                        onChange={(e) => updateVariant(variant.clientKey, { sortOrder: e.target.value })}
                        type="number"
                        min={0}
                        dir="ltr"
                      />
                    </label>
                  </div>

                  <VariantAttributesEditor
                    variant={variant}
                    onChange={(next) => updateVariant(variant.clientKey, next)}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      </WizardSectionCard>

      <datalist id="catalog-category-suggestions">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <datalist id="catalog-variant-group-suggestions">
        {variantGroups.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>

      {saving && <p className="hint-text">جاري الحفظ…</p>}
    </form>
  );
}
