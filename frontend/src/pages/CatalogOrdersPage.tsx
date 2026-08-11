import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  ORDER_STATUS_CLASS,
  ORDER_STATUS_LABELS,
  formatOrderAmount,
  formatOrderDate,
  type CatalogOrder,
  type CatalogOrderListResponse,
  type CatalogOrderStatus
} from "../lib/catalogOrderHelpers";
import { type Organization } from "../lib/contactHelpers";

const PAGE_SIZE = 25;

export default function CatalogOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<CatalogOrderStatus | "">("");
  const [orgFilter, setOrgFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, orgFilter, debouncedSearch]);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const orders = useQuery({
    queryKey: ["catalog-orders", statusFilter, orgFilter, debouncedSearch, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(PAGE_SIZE));
      if (statusFilter) params.set("status", statusFilter);
      if (orgFilter) params.set("organization_id", orgFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return (await api.get<CatalogOrderListResponse>(`/catalog/orders?${params.toString()}`)).data;
    }
  });

  const totalPages = Math.max(1, Math.ceil((orders.data?.total ?? 0) / PAGE_SIZE));

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell">
        <header className="contacts-erp-header">
          <div className="contacts-erp-title-block">
            <Link to="/catalog" className="contacts-back-link">← المنتجات والخدمات</Link>
            <h1>طلبات الكتالوج</h1>
            <p className="hint-text">طلبات واتساب المؤكدة من الكتالوج — مراجعة، متابعة، وإصدار فاتورة PDF.</p>
          </div>
          <div className="contacts-erp-actions">
            <Link to="/catalog" className="contacts-erp-btn">المنتجات</Link>
            <Link to="/crm" className="contacts-erp-btn">CRM</Link>
          </div>
        </header>

        <div className="contacts-erp-toolbar catalog-orders-toolbar">
          <input
            className="catalog-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الطلب أو اسم العميل أو الهاتف…"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CatalogOrderStatus | "")}>
            <option value="">كل الحالات</option>
            {(Object.keys(ORDER_STATUS_LABELS) as CatalogOrderStatus[]).map((status) => (
              <option key={status} value={status}>{ORDER_STATUS_LABELS[status]}</option>
            ))}
          </select>
          <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">كل الفروع</option>
            {(organizations.data ?? []).map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>

        <div className="contacts-erp-table-wrap">
          <table className="contacts-erp-table catalog-orders-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>العميل</th>
                <th>التاريخ</th>
                <th>الأصناف</th>
                <th>الإجمالي</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {orders.isLoading && (
                <tr><td colSpan={7} className="catalog-orders-empty">جاري التحميل…</td></tr>
              )}
              {!orders.isLoading && (orders.data?.items.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="catalog-orders-empty">لا توجد طلبات بعد.</td></tr>
              )}
              {(orders.data?.items ?? []).map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </tbody>
          </table>
        </div>

        <footer className="contacts-erp-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>السابق</button>
          <span>{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>التالي</button>
        </footer>
      </section>
    </main>
  );
}

function OrderRow({ order }: { order: CatalogOrder }) {
  const itemCount = order.line_items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  return (
    <tr>
      <td><strong dir="ltr">{order.order_number}</strong></td>
      <td>
        <div className="admin-cell-stack">
          <strong>{order.contact_name || "—"}</strong>
          <small dir="ltr">{order.contact_phone}</small>
        </div>
      </td>
      <td><small>{formatOrderDate(order.created_at)}</small></td>
      <td>{itemCount}</td>
      <td dir="ltr">{formatOrderAmount(order)}</td>
      <td>
        <span className={`catalog-order-status ${ORDER_STATUS_CLASS[order.status]}`}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </td>
      <td>
        <Link to={`/catalog/orders/${order.id}`} className="contacts-erp-btn">فتح</Link>
      </td>
    </tr>
  );
}
