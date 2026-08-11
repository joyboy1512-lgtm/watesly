import { type ProductFormState } from "../lib/catalogHelpers";

type Organization = { id: string; name: string };

type CatalogSimpleProductFormProps = {
  form: ProductFormState;
  setForm: (updater: (current: ProductFormState) => ProductFormState) => void;
  organizations: Organization[];
  uploadingImage: boolean;
  onUploadImage: (file: File) => void;
};

export default function CatalogSimpleProductForm({
  form,
  setForm,
  organizations,
  uploadingImage,
  onUploadImage
}: CatalogSimpleProductFormProps) {
  return (
    <div className="catalog-simple-form stack-form">
      <div className="catalog-image-row catalog-simple-image">
        <div className="catalog-image-thumb">
          {form.imageUrl ? (
            <img src={form.imageUrl} alt={form.name || "معاينة"} className="catalog-form-image" />
          ) : (
            <div className="catalog-form-image placeholder">صورة</div>
          )}
        </div>
        <div className="catalog-image-controls">
          <label className="field-label">
            <span>صورة المنتج *</span>
            <p className="hint-text">مطلوبة لـ Meta — JPG/PNG، 500×500 على الأقل.</p>
          </label>
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
            placeholder="https://…"
            dir="ltr"
            required
          />
        </div>
      </div>

      <label className="field-label">
        <span>اسم المنتج *</span>
        <input
          value={form.name}
          onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
          placeholder="مثال: جل استحمام دوف 400مل"
          required
        />
      </label>

      <div className="catalog-fields-row-fit">
        <label className="field-label catalog-field-w-grow">
          <span>السعر *</span>
          <input
            value={form.price}
            onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))}
            placeholder="0.000"
            type="number"
            step="0.001"
            min="0.001"
            dir="ltr"
            required
          />
        </label>
        <label className="field-label catalog-field-w-xs">
          <span>العملة</span>
          <input
            value={form.currency}
            onChange={(e) => setForm((current) => ({ ...current, currency: e.target.value }))}
            placeholder="KWD"
            dir="ltr"
          />
        </label>
      </div>

      <label className="field-label">
        <span>الوصف</span>
        <textarea
          value={form.description}
          onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
          placeholder="وصف مختصر يظهر في كتالوج WhatsApp"
          rows={3}
        />
      </label>

      <label className="field-label">
        <span>SKU / رمز المنتج</span>
        <input
          value={form.sku}
          onChange={(e) => setForm((current) => ({ ...current, sku: e.target.value }))}
          placeholder="يُستخدم كـ retailer_id في Meta إن وُجد"
          dir="ltr"
        />
      </label>

      {organizations.length > 1 && (
        <label className="field-label">
          <span>الفرع *</span>
          <select
            value={form.organizationId}
            onChange={(e) => setForm((current) => ({ ...current, organizationId: e.target.value }))}
            required
          >
            <option value="">— اختر الفرع —</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="catalog-meta-sync-chip">
        <input
          type="checkbox"
          checked={form.metaSyncEnabled}
          onChange={(e) => setForm((current) => ({ ...current, metaSyncEnabled: e.target.checked }))}
        />
        <span>مزامنة تلقائية مع Meta بعد الحفظ</span>
        <span className="catalog-meta-sync-state">{form.metaSyncEnabled ? "مفعّلة" : "موقوفة"}</span>
      </label>
    </div>
  );
}
