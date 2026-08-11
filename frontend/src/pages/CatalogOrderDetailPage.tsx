import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  ORDER_STATUS_LABELS,
  downloadCatalogOrderInvoice,
  formatOrderAmount,
  formatOrderDate,
  type CatalogOrder,
  type CatalogOrderStatus
} from "../lib/catalogOrderHelpers";
import { openContactConversation } from "../lib/contactHelpers";
import { toastStore } from "../stores/toast";

export default function CatalogOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const order = useQuery({
    queryKey: ["catalog-order", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<CatalogOrder>(`/catalog/orders/${id}`)).data
  });

  async function markStatus(status: CatalogOrderStatus) {
    if (!id) return;
    try {
      await api.patch(`/catalog/orders/${id}`, { status });
      await client.invalidateQueries({ queryKey: ["catalog-order", id] });
      await client.invalidateQueries({ queryKey: ["catalog-orders"] });
      toastStore.getState().show("تم تحديث حالة الطلب.", "success");
    } catch {
      toastStore.getState().show("تعذر تحديث الحالة.", "error");
    }
  }

  async function downloadInvoice() {
    if (!order.data) return;
    setDownloading(true);
    try {
      await downloadCatalogOrderInvoice(order.data.id, order.data.order_number);
      await client.invalidateQueries({ queryKey: ["catalog-order", id] });
      await client.invalidateQueries({ queryKey: ["catalog-orders"] });
      toastStore.getState().show("تم تحميل الفاتورة PDF.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء PDF.", "error");
    } finally {
      setDownloading(false);
    }
  }

  const item = order.data;

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell catalog-order-detail-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/catalog/orders" className="contacts-back-link">← طلبات الكتالوج</Link>
            <h1>{item ? `طلب ${item.order_number}` : "تفاصيل الطلب"}</h1>
          </div>
          {item && (
            <div className="contacts-form-topbar-actions">
              <button
                type="button"
                className="contacts-erp-btn"
                disabled={item.status === "reviewed" || item.status === "invoiced"}
                onClick={() => void markStatus("reviewed")}
              >
                تمت المراجعة
              </button>
              <button
                type="button"
                className="contacts-erp-btn contacts-erp-btn-primary"
                disabled={downloading}
                onClick={() => void downloadInvoice()}
              >
                {downloading ? "جاري إنشاء PDF…" : "تحميل فاتورة PDF"}
              </button>
            </div>
          )}
        </header>

        {order.isLoading && <p className="catalog-orders-empty">جاري التحميل…</p>}
        {!order.isLoading && !item && <p className="catalog-orders-empty">الطلب غير موجود.</p>}

        {item && (
          <div className="catalog-order-detail-grid">
            <section className="catalog-order-panel">
              <h2>بيانات الطلب</h2>
              <dl className="catalog-order-meta">
                <div><dt>الحالة</dt><dd>{ORDER_STATUS_LABELS[item.status]}</dd></div>
                <div><dt>التاريخ</dt><dd>{formatOrderDate(item.created_at)}</dd></div>
                <div><dt>الإجمالي</dt><dd dir="ltr">{formatOrderAmount(item)}</dd></div>
                {item.meta_catalog_id && <div><dt>Catalog ID</dt><dd dir="ltr">{item.meta_catalog_id}</dd></div>}
                {item.customer_note && <div><dt>ملاحظة العميل</dt><dd>{item.customer_note}</dd></div>}
              </dl>
            </section>

            <section className="catalog-order-panel">
              <h2>العميل</h2>
              <dl className="catalog-order-meta">
                <div><dt>الاسم</dt><dd>{item.contact_name || "—"}</dd></div>
                <div><dt>WhatsApp</dt><dd dir="ltr">{item.contact_phone || "—"}</dd></div>
              </dl>
              <div className="catalog-order-links">
                {item.conversation_id && (
                  <button
                    type="button"
                    className="contacts-erp-btn"
                    onClick={() => void openContactConversation(item.contact_id)}
                  >
                    فتح المحادثة
                  </button>
                )}
                <Link to={`/contacts/${item.contact_id}`} className="contacts-erp-btn">ملف العميل</Link>
                {item.deal_id && <Link to={`/crm/${item.deal_id}`} className="contacts-erp-btn">صفقة CRM</Link>}
              </div>
            </section>

            <section className="catalog-order-panel catalog-order-lines-panel">
              <h2>المنتجات المطلوبة</h2>
              <div className="contacts-erp-table-wrap">
                <table className="contacts-erp-table catalog-order-lines-table">
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>SKU / Retailer ID</th>
                      <th>الكمية</th>
                      <th>السعر</th>
                      <th>الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.line_items.map((line) => (
                      <tr key={`${line.product_retailer_id}-${line.quantity}`}>
                        <td>{line.product_name}</td>
                        <td dir="ltr"><code>{line.product_retailer_id}</code></td>
                        <td>{line.quantity}</td>
                        <td dir="ltr">{line.unit_price ? `${line.unit_price} ${line.currency}` : "—"}</td>
                        <td dir="ltr">{line.line_total ? `${line.line_total} ${line.currency}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}><strong>الإجمالي</strong></td>
                      <td dir="ltr"><strong>{formatOrderAmount(item)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="catalog-order-invoice-preview" id="catalog-order-invoice-print">
              <h2>معاينة الفاتورة</h2>
              <div className="catalog-invoice-card">
                <header className="catalog-invoice-head">
                  <div>
                    <strong>فاتورة طلب كتالوج</strong>
                    <small dir="ltr">{item.order_number}</small>
                  </div>
                  <div className="catalog-invoice-meta">
                    <span>{formatOrderDate(item.created_at)}</span>
                    <span>{item.contact_name || "عميل"}</span>
                    {item.contact_phone && <span dir="ltr">{item.contact_phone}</span>}
                  </div>
                </header>
                <table className="catalog-invoice-table">
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>الكمية</th>
                      <th>السعر</th>
                      <th>الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.line_items.map((line) => (
                      <tr key={`preview-${line.product_retailer_id}`}>
                        <td>{line.product_name}</td>
                        <td>{line.quantity}</td>
                        <td dir="ltr">{line.unit_price ? `${line.unit_price} ${line.currency}` : "—"}</td>
                        <td dir="ltr">{line.line_total ? `${line.line_total} ${line.currency}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <footer className="catalog-invoice-foot">
                  <strong dir="ltr">{formatOrderAmount(item)}</strong>
                  {item.customer_note && <p>ملاحظة: {item.customer_note}</p>}
                </footer>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
