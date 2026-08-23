import { type ProductFormState } from "../lib/catalogHelpers";
import { type WhatsAppAccountRow, whatsappAccountLabel } from "../lib/whatsappHelpers";

type Organization = { id: string; name: string };

type CatalogSimpleProductFormProps = {
  form: ProductFormState;
  setForm: (updater: (current: ProductFormState) => ProductFormState) => void;
  organizations: Organization[];
  whatsappAccounts: WhatsAppAccountRow[];
  uploadingImage: boolean;
  onUploadImage: (file: File) => void;
};

export default function CatalogSimpleProductForm({
  form,
  setForm,
  organizations,
  whatsappAccounts,
  uploadingImage,
  onUploadImage
}: CatalogSimpleProductFormProps) {
  const selectedAccount = whatsappAccounts.find((item) => item.channel_id === form.channelId);
  const branchCommerceReady = Boolean(
    selectedAccount?.commerce_enabled && selectedAccount.meta_catalog_id?.trim()
  );

  function selectChannel(channelId: string) {
    const account = whatsappAccounts.find((item) => item.channel_id === channelId);
    setForm((current) => ({
      ...current,
      channelId,
      organizationId: account?.organization_id ?? current.organizationId
    }));
  }

  return (
    <div className="catalog-simple-form stack-form">
      {(whatsappAccounts.length > 0 || organizations.length > 0) && (
        <div className="catalog-branch-block">
          {whatsappAccounts.length > 1 ? (
            <label className="field-label">
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
            <p className="catalog-branch-label">
              <span>قناة WhatsApp</span>
              <strong>{whatsappAccountLabel(whatsappAccounts[0])}</strong>
            </p>
          ) : null}

          {organizations.length > 1 ? (
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
          ) : organizations.length === 1 ? (
            <p className="catalog-branch-label">
              <span>الفرع</span>
              <strong>{organizations[0].name}</strong>
            </p>
          ) : null}

          <p className={`hint-text catalog-branch-hint ${branchCommerceReady ? "ready" : "warn"}`}>
            {form.channelId
              ? branchCommerceReady
                ? `سيُعرض المنتج في كتالوج ${whatsappAccountLabel(selectedAccount!)} ويُزامَن مع Meta.`
                : "هذه القناة لا تملك Commerce أو Catalog ID — فعّلهما من صفحة ربط WhatsApp."
              : "اختر قناة WhatsApp — كل منتج يجب أن ينتمي لقناة واحدة."}
          </p>
        </div>
      )}

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
              accept="image/*"
              hidden
              disabled={uploadingImage}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadImage(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <label className="field-label">
            <span>أو رابط HTTPS</span>
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => setForm((current) => ({ ...current, imageUrl: e.target.value }))}
              placeholder="https://..."
              dir="ltr"
            />
          </label>
        </div>
      </div>

      <label className="field-label">
        <span>اسم المنتج *</span>
        <input
          value={form.name}
          onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
          placeholder="مثال: Shower Gel — Dovey 400ml"
          required
        />
      </label>

      <div className="catalog-simple-price-row">
        <label className="field-label">
          <span>السعر *</span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={form.price}
            onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))}
            required
          />
        </label>
        <label className="field-label">
          <span>العملة</span>
          <input
            value={form.currency}
            onChange={(e) => setForm((current) => ({ ...current, currency: e.target.value.toUpperCase() }))}
            maxLength={3}
            dir="ltr"
          />
        </label>
      </div>

      <label className="field-label">
        <span>SKU / retailer ID</span>
        <input
          value={form.sku}
          onChange={(e) => setForm((current) => ({ ...current, sku: e.target.value }))}
          placeholder="اختياري — يُستخدم في Meta"
          dir="ltr"
        />
      </label>

      <label className="field-label">
        <span>الوصف</span>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
          placeholder="يظهر في كتالوج WhatsApp"
        />
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.metaSyncEnabled}
          onChange={(e) => setForm((current) => ({ ...current, metaSyncEnabled: e.target.checked }))}
        />
        <span>مزامنة تلقائية مع Meta عند الحفظ</span>
      </label>
    </div>
  );
}
