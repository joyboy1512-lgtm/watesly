import { type ProductFormState } from "../lib/catalogHelpers";

type Organization = { id: string; name: string };

type CatalogProductFormFieldsProps = {
  form: ProductFormState;
  setForm: (updater: (current: ProductFormState) => ProductFormState) => void;
  organizations: Organization[];
  categories: string[];
  specKey: string;
  setSpecKey: (value: string) => void;
  specValue: string;
  setSpecValue: (value: string) => void;
  onAddSpec: () => void;
  onRemoveSpec: (key: string) => void;
  uploadingImage: boolean;
  onUploadImage: (file: File) => void;
};

export default function CatalogProductFormFields({
  form,
  setForm,
  organizations,
  categories,
  specKey,
  setSpecKey,
  specValue,
  setSpecValue,
  onAddSpec,
  onRemoveSpec,
  uploadingImage,
  onUploadImage
}: CatalogProductFormFieldsProps) {
  return (
    <>
      <div className="catalog-fields-row">
        <label className="field-label">
          <span>النوع</span>
          <select
            value={form.productType}
            onChange={(e) => setForm((current) => ({ ...current, productType: e.target.value as "product" | "service" }))}
          >
            <option value="product">منتج</option>
            <option value="service">خدمة</option>
          </select>
        </label>
        <label className="field-label catalog-field-grow">
          <span>اسم المنتج أو الخدمة</span>
          <input
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder="مثال: مكيف 2 طن"
            required
          />
        </label>
      </div>

      <div className="catalog-fields-row">
        <label className="field-label">
          <span>SKU / رمز</span>
          <input
            value={form.sku}
            onChange={(e) => setForm((current) => ({ ...current, sku: e.target.value }))}
            placeholder="AC-2T-001"
            dir="ltr"
          />
        </label>
        <label className="field-label">
          <span>ترتيب العرض</span>
          <input
            value={form.sortOrder}
            onChange={(e) => setForm((current) => ({ ...current, sortOrder: e.target.value }))}
            type="number"
            min={0}
            dir="ltr"
          />
        </label>
        <label className="field-label">
          <span>الفرع {organizations.length === 1 ? "" : "(مطلوب لموظفي الفرع)"}</span>
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
        <label className="field-label">
          <span>الصنف / الفئة</span>
          <input
            value={form.category}
            onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
            placeholder="مكيفات، صيانة…"
            list="catalog-category-suggestions"
          />
        </label>
        <label className="field-label">
          <span>Meta Retailer ID</span>
          <input
            value={form.metaRetailerId}
            onChange={(e) => setForm((current) => ({ ...current, metaRetailerId: e.target.value }))}
            placeholder="SKU أو معرّف Meta"
            dir="ltr"
          />
        </label>
      </div>

      <label className="field-label catalog-meta-sync-toggle">
        <span>مزامنة Meta</span>
        <div className="catalog-meta-sync-toggle-row">
          <input
            type="checkbox"
            checked={form.metaSyncEnabled}
            onChange={(e) => setForm((current) => ({ ...current, metaSyncEnabled: e.target.checked }))}
          />
          <span className="hint-text">
            {form.metaSyncEnabled
              ? "سيُرسل المنتج عند مزامنة الكتالogg مع Meta."
              : "لن يُرسل إلى Meta — وإن كان مزامَناً سابقاً يُخفى من الكتالogg."}
          </span>
        </div>
      </label>

      <label className="field-label">
        <span>الوصف</span>
        <textarea
          value={form.description}
          onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
          placeholder="وصف مختصر للعميل"
          rows={3}
        />
      </label>

      <div className="catalog-fields-row">
        <label className="field-label">
          <span>نوع السعر</span>
          <select
            value={form.priceType}
            onChange={(e) => setForm((current) => ({ ...current, priceType: e.target.value as ProductFormState["priceType"] }))}
          >
            <option value="fixed">سعر ثابت</option>
            <option value="from">يبدأ من</option>
            <option value="quote">عرض سعر</option>
          </select>
        </label>
        {form.priceType !== "quote" && (
          <>
            <label className="field-label">
              <span>السعر</span>
              <input
                value={form.price}
                onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))}
                placeholder="0.000"
                type="number"
                step="0.001"
                dir="ltr"
                required
              />
            </label>
            <label className="field-label">
              <span>العملة</span>
              <input
                value={form.currency}
                onChange={(e) => setForm((current) => ({ ...current, currency: e.target.value }))}
                placeholder="KWD"
                dir="ltr"
              />
            </label>
          </>
        )}
      </div>

      <label className="field-label">
        <span>كلمات البحث</span>
        <input
          value={form.keywords}
          onChange={(e) => setForm((current) => ({ ...current, keywords: e.target.value }))}
          placeholder="مكيف، صيانة، تركيب…"
        />
      </label>

      <div className="catalog-specs-block">
        <span className="field-label-title">المواصفات</span>
        <div className="spec-builder">
          <input value={specKey} onChange={(e) => setSpecKey(e.target.value)} placeholder="المواصفة (القدرة)" />
          <input value={specValue} onChange={(e) => setSpecValue(e.target.value)} placeholder="القيمة (2 طن)" />
          <button type="button" onClick={onAddSpec}>+ إضافة</button>
        </div>
        {Object.keys(form.specs).length > 0 && (
          <ul className="spec-list">
            {Object.entries(form.specs).map(([key, value]) => (
              <li key={key}>
                <strong>{key}:</strong> {value}
                <button type="button" className="danger-link" onClick={() => onRemoveSpec(key)}>حذف</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="catalog-image-field">
        <span className="field-label-title">صورة المنتج</span>
        {form.imageUrl ? (
          <img src={form.imageUrl} alt={form.name || "معاينة"} className="catalog-form-image" />
        ) : (
          <div className="catalog-form-image placeholder">بدون صورة</div>
        )}
        <div className="catalog-image-actions">
          <label className="secondary-button compact">
            {uploadingImage ? "جاري الرفع…" : "رفع صورة"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={uploadingImage}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUploadImage(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <input
            value={form.imageUrl}
            onChange={(e) => setForm((current) => ({ ...current, imageUrl: e.target.value }))}
            placeholder="أو الصق رابط الصورة"
            dir="ltr"
          />
        </div>
      </div>

      <datalist id="catalog-category-suggestions">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </>
  );
}
