import { useState, type ReactNode } from "react";
import {
  emptyOfferVariant,
  slugifyMetaGroupId,
  type OfferGroupFormState,
  type OfferVariantFormState
} from "../lib/catalogHelpers";
import { uploadFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };

type CatalogOfferWizardProps = {
  form: OfferGroupFormState;
  setForm: (updater: (current: OfferGroupFormState) => OfferGroupFormState) => void;
  organizations: Organization[];
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
  tone: "shared" | "variants" | "offer";
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

const OFFER_TONES = ["amber", "violet", "teal", "blue"] as const;

function offerTone(index: number) {
  return OFFER_TONES[index % OFFER_TONES.length];
}

export default function CatalogOfferWizard({
  form,
  setForm,
  organizations,
  categories,
  variantGroups,
  formId = "catalog-offer-wizard",
  onSubmit,
  saving = false
}: CatalogOfferWizardProps) {
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function updateVariant(clientKey: string, patch: Partial<OfferVariantFormState>) {
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
      variants: [...current.variants, emptyOfferVariant(current.variants.length)]
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
      toastStore.getState().show("تم رفع صورة العرض.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploadingKey(null);
    }
  }

  function autoGroupId() {
    const slug = slugifyMetaGroupId(form.baseName);
    if (!slug) {
      toastStore.getState().show("أدخل اسم العرض الأساسي أولاً.", "error");
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
        tone="offer"
        title="العرض الأساسي"
        hint="اسم الحملة والوصف والصنف — يُشارَك بين كل العروض الفرعية في WhatsApp"
      >
        <label className="field-label">
          <span>اسم العرض الأساسي *</span>
          <input
            value={form.baseName}
            onChange={(e) => setForm((current) => ({ ...current, baseName: e.target.value }))}
            placeholder="مثال: عرض رمضان 2026"
            required
          />
        </label>

        <div className="catalog-fields-row-fit">
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
            <span>الصنف *</span>
            <input
              value={form.category}
              onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
              placeholder="عروض"
              list="catalog-offer-category-suggestions"
              required
            />
          </label>
        </div>

        <label className="field-label">
          <span>وصف العرض</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
            placeholder="تفاصيل العرض التي يراها العميل في WhatsApp"
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
                  priceType: e.target.value as OfferGroupFormState["priceType"]
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

        <div className="catalog-offer-advanced">
          <button
            type="button"
            className="contacts-erp-btn catalog-offer-advanced-toggle"
            onClick={() => setShowAdvanced((current) => !current)}
          >
            {showAdvanced ? "إخفاء الإعدادات المتقدمة" : "إعدادات Meta المتقدمة"}
          </button>
          {showAdvanced && (
            <div className="catalog-field-with-action">
              <label className="field-label">
                <span>مجموعة المنتج (item_group_id) *</span>
                <input
                  value={form.metaItemGroupId}
                  onChange={(e) => setForm((current) => ({ ...current, metaItemGroupId: e.target.value }))}
                  placeholder="ramadan-offer-2026"
                  dir="ltr"
                  list="catalog-offer-group-suggestions"
                  required
                />
              </label>
              <button type="button" className="contacts-erp-btn catalog-field-action-btn" onClick={autoGroupId}>
                توليد من الاسم
              </button>
            </div>
          )}
        </div>
      </WizardSectionCard>

      <WizardSectionCard
        tone="variants"
        title="العروض الفرعية"
        hint="كل بطاقة = عرض مستقل (باقة، نوع، أو مستوى) — صورة وسعر خاص لكل واحد"
        action={
          <button type="button" className="contacts-erp-btn catalog-wizard-header-btn" onClick={addVariant}>
            + عرض فرعي
          </button>
        }
      >
        <div className="catalog-variant-cards">
          {form.variants.map((variant, index) => (
            <article key={variant.clientKey} className={`catalog-variant-card tone-${offerTone(index)}`}>
              <header className="catalog-variant-card-head">
                <div className="catalog-variant-card-title">
                  <span className="catalog-variant-card-badge">{index + 1}</span>
                  <strong>{variant.offerLabel.trim() || `عرض فرعي ${index + 1}`}</strong>
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
                      <img src={variant.imageUrl} alt={variant.offerLabel || `عرض ${index + 1}`} className="catalog-form-image" />
                    ) : (
                      <div className="catalog-form-image placeholder">—</div>
                    )}
                  </div>
                  <div className="catalog-variant-image-controls">
                    <span className="field-label-title">صورة العرض *</span>
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
                      required
                    />
                  </div>
                </div>

                <div className="catalog-variant-card-fields">
                  <div className="catalog-fields-row-fit">
                    <label className="field-label catalog-field-w-grow">
                      <span>اسم الباقة / العرض الفرعي *</span>
                      <input
                        value={variant.offerLabel}
                        onChange={(e) => updateVariant(variant.clientKey, { offerLabel: e.target.value })}
                        placeholder="مثال: أساسي، ذهبي، VIP، عائلي"
                        required
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
                    <label className="field-label catalog-field-w-md">
                      <span>SKU (اختياري)</span>
                      <input
                        value={variant.sku}
                        onChange={(e) => updateVariant(variant.clientKey, { sku: e.target.value })}
                        placeholder="RAMADAN-GOLD"
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
                </div>
              </div>
            </article>
          ))}
        </div>
      </WizardSectionCard>

      <datalist id="catalog-offer-category-suggestions">
        <option value="عروض" />
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <datalist id="catalog-offer-group-suggestions">
        {variantGroups.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>

      {saving && <p className="hint-text">جاري الحفظ…</p>}
    </form>
  );
}
