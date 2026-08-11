import { api } from "./api";

export type CatalogOrderStatus = "received" | "reviewed" | "invoiced" | "cancelled";

export type CatalogOrderLineItem = {
  product_retailer_id: string;
  product_name: string;
  quantity: number;
  unit_price: string | null;
  currency: string;
  line_total: string | null;
};

export type CatalogOrder = {
  id: string;
  order_number: string;
  status: CatalogOrderStatus;
  currency: string;
  subtotal: string;
  customer_note: string | null;
  meta_catalog_id: string | null;
  line_items: CatalogOrderLineItem[];
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  conversation_id: string | null;
  deal_id: string | null;
  organization_id: string;
  channel_id: string;
  message_id: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogOrderListResponse = {
  items: CatalogOrder[];
  total: number;
  page: number;
  page_size: number;
};

export const ORDER_STATUS_LABELS: Record<CatalogOrderStatus, string> = {
  received: "جديد",
  reviewed: "تمت المراجعة",
  invoiced: "صُدرت فاتورة",
  cancelled: "ملغي"
};

export const ORDER_STATUS_CLASS: Record<CatalogOrderStatus, string> = {
  received: "catalog-order-status-new",
  reviewed: "catalog-order-status-reviewed",
  invoiced: "catalog-order-status-invoiced",
  cancelled: "catalog-order-status-cancelled"
};

export function formatOrderAmount(order: Pick<CatalogOrder, "subtotal" | "currency">) {
  const value = Number(order.subtotal);
  if (Number.isNaN(value)) return `${order.subtotal} ${order.currency}`;
  return `${value.toFixed(3)} ${order.currency}`;
}

export function formatOrderDate(value: string) {
  try {
    return new Intl.DateTimeFormat("ar-KW", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export async function downloadCatalogOrderInvoice(orderId: string, orderNumber: string) {
  const response = await api.get(`/catalog/orders/${orderId}/invoice.pdf`, {
    responseType: "blob"
  });
  const blob = new Blob([response.data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${orderNumber}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
