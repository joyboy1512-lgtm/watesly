import { catalogTypeLabel, type MatchedCatalogProduct } from "../lib/catalogHelpers";

type Props = {
  product: MatchedCatalogProduct;
  compact?: boolean;
  onUse?: () => void;
  onSendImage?: () => void;
  onSendProductCard?: () => void;
  useLabel?: string;
};

export default function CatalogProductCard({ product, compact, onUse, onSendImage, onSendProductCard, useLabel = "إدراج" }: Props) {
  return (
    <article className={`catalog-product-card ${compact ? "compact" : ""}`}>
      {product.image_url ? (
        <img src={product.image_url} alt={product.name} className="catalog-product-card-image" loading="lazy" />
      ) : (
        <div className="catalog-product-card-image placeholder">{product.product_type === "service" ? "🛠" : "📦"}</div>
      )}
      <div className="catalog-product-card-body">
        <div className="catalog-product-card-head">
          <strong>{product.name}</strong>
          {product.product_type && <span className="catalog-type-badge">{catalogTypeLabel(product.product_type)}</span>}
        </div>
        <p className="catalog-product-card-price">{product.price_label}</p>
        {product.specs_preview && <p className="catalog-product-card-specs">{product.specs_preview}</p>}
        {!compact && product.description && <p className="catalog-product-card-desc">{product.description}</p>}
        {(onUse || onSendImage) && (
          <div className="catalog-product-card-actions">
            {onUse && (
              <button type="button" className="secondary-button compact" onClick={onUse}>
                {useLabel}
              </button>
            )}
            {onSendImage && product.image_url && (
              <button type="button" className="secondary-button compact" onClick={onSendImage}>
                إرسال الصورة
              </button>
            )}
            {onSendProductCard && (
              <button type="button" className="whatsapp-button compact" onClick={onSendProductCard}>
                بطاقة منتج
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
