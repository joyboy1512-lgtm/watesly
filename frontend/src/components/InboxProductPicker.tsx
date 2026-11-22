import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  catalogPriceLabel,
  formatProductWhatsAppLine,
  type CatalogProduct,
  type MatchedCatalogProduct
} from "../lib/catalogHelpers";
import CatalogProductCard from "./CatalogProductCard";
import Icon from "./Icon";

type Props = {
  open: boolean;
  onClose: () => void;
  disabled?: boolean;
  channelId?: string | null;
  onInsert: (text: string, product: MatchedCatalogProduct) => void;
  onSendImage?: (product: MatchedCatalogProduct) => void;
  onSendProductCard?: (product: MatchedCatalogProduct) => void;
  onSendCartSummary?: (summary: string, products: MatchedCatalogProduct[]) => void;
};

function toMatchedProduct(product: CatalogProduct): MatchedCatalogProduct {
  return {
    id: product.id,
    name: product.name,
    price_label: catalogPriceLabel(product),
    image_url: product.image_url,
    description: product.description,
    specs_preview: formatSpecs(product.specs_json),
    product_type: product.product_type
  };
}

function formatSpecs(specs: Record<string, string>) {
  const entries = Object.entries(specs ?? {});
  if (!entries.length) return null;
  return entries.map(([key, value]) => `${key}: ${value}`).join(" · ");
}

export function buildCartSummary(products: MatchedCatalogProduct[]) {
  if (!products.length) return "";
  const lines = products.map((item, index) => `${index + 1}) ${formatProductWhatsAppLine(item)}`);
  return ["🛒 ملخص الطلب:", ...lines].join("\n");
}

export default function InboxProductPicker({
  open,
  onClose,
  disabled,
  channelId,
  onInsert,
  onSendImage,
  onSendProductCard,
  onSendCartSummary
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIds([]);
    }
  }, [open]);

  const products = useQuery({
    queryKey: ["catalog-picker", query, channelId],
    enabled: open,
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (channelId) params.channel_id = channelId;
      if (query.trim()) {
        params.q = query.trim();
        params.limit = 12;
        return (await api.get<CatalogProduct[]>("/catalog/search", { params })).data;
      }
      return (await api.get<CatalogProduct[]>("/catalog", { params })).data.slice(0, 12);
    }
  });

  const rows = useMemo(
    () => (products.data ?? []).map((item) => toMatchedProduct(item)),
    [products.data]
  );

  const cart = useMemo(
    () => rows.filter((item) => item.id && selectedIds.includes(item.id)),
    [rows, selectedIds]
  );

  if (!open) return null;

  function toggle(productId: string) {
    setSelectedIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
    );
  }

  return (
    <div className="inbox-product-picker">
      <div className="inbox-product-picker-head">
        <strong>إدراج منتج / سلة</strong>
        <button type="button" className="secondary-action" onClick={onClose} aria-label="إغلاق">×</button>
      </div>
      <div className="inbox-product-picker-search">
        <Icon name="search" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث في الكتالوج…"
          disabled={disabled}
        />
      </div>
      {cart.length > 0 && (
        <div className="inbox-product-cart">
          <span>السلة: {cart.length} منتج</span>
          <div className="inline-actions">
            <button
              type="button"
              className="whatsapp-button"
              disabled={disabled}
              onClick={() => {
                const summary = buildCartSummary(cart);
                if (onSendCartSummary) onSendCartSummary(summary, cart);
                else onInsert(summary, cart[0]);
                onClose();
              }}
            >
              إرسال ملخص الطلب
            </button>
            <button type="button" className="secondary-button" onClick={() => setSelectedIds([])}>
              تفريغ
            </button>
          </div>
        </div>
      )}
      <div className="inbox-product-picker-list">
        {products.isLoading && <p className="hint-text">جاري التحميل…</p>}
        {!products.isLoading && rows.length === 0 && <p className="hint-text">لا توجد منتجات.</p>}
        {rows.map((product) => {
          const checked = Boolean(product.id && selectedIds.includes(product.id));
          return (
            <div key={product.id || product.name} className="inbox-product-picker-row">
              <label className="inbox-product-check">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!product.id || disabled}
                  onChange={() => product.id && toggle(product.id)}
                />
                <span>إضافة للسلة</span>
              </label>
              <CatalogProductCard
                product={product}
                compact
                useLabel="إدراج في الرد"
                onUse={() => {
                  onInsert(formatProductWhatsAppLine(product), product);
                  onClose();
                }}
                onSendImage={onSendImage ? () => onSendImage(product) : undefined}
                onSendProductCard={onSendProductCard ? () => onSendProductCard(product) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
