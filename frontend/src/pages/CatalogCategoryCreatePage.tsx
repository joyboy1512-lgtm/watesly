import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { type CatalogProduct } from "../lib/catalogHelpers";
import { toastStore } from "../stores/toast";

export default function CatalogCategoryCreatePage() {
  const navigate = useNavigate();
  const [categoryName, setCategoryName] = useState("");

  const categories = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => (await api.get<string[]>("/catalog/categories")).data
  });

  const products = useQuery({
    queryKey: ["catalog", "categories-overview"],
    queryFn: async () => (await api.get<CatalogProduct[]>("/catalog")).data
  });

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products.data ?? []) {
      const name = product.category?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [products.data]);

  const sortedCategories = useMemo(() => {
    const names = new Set([...(categories.data ?? []), ...categoryCounts.keys()]);
    return [...names].sort((left, right) => left.localeCompare(right, "ar"));
  }, [categories.data, categoryCounts]);

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) {
      toastStore.getState().show("أدخل اسم الصنف.", "error");
      return;
    }
    toastStore.getState().show("تم تسجيل الصنف — أضف أول منتج له.", "success");
    const mode = /عرض/i.test(name) ? "offer" : "single";
    navigate(`/catalog/new?mode=${mode}&category=${encodeURIComponent(name)}`, { replace: true });
  }

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/catalog" className="contacts-back-link">← المنتجات والخدمات</Link>
            <h1>إنشاء صنف</h1>
          </div>
        </header>

        <div className="catalog-create-layout">
          <form className="catalog-panel stack-form" onSubmit={submitCategory}>
            <h2 className="section-title-sm">صنف جديد</h2>
            <p className="hint-text">
              الأصناف تُربط بالمنتجات. بعد تسجيل الصنف ستنتقل لإضافة أول منتج ضمنه.
            </p>
            <label className="field-label">
              <span>اسم الصنف</span>
              <input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="مثال: مكيفات، صيانة، تركيب…"
                list="catalog-existing-categories"
                required
              />
            </label>
            <datalist id="catalog-existing-categories">
              {sortedCategories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <div className="catalog-card-actions">
              <button type="submit" className="contacts-erp-btn contacts-erp-btn-primary">متابعة لإنشاء منتج</button>
              <Link to="/catalog" className="contacts-erp-btn">إلغاء</Link>
            </div>
          </form>

          <section className="catalog-panel">
            <h2 className="section-title-sm">الأصناف المسجلة</h2>
            {products.isLoading && <p className="hint-text">جاري التحميل…</p>}
            {!products.isLoading && sortedCategories.length === 0 && (
              <p className="hint-text">لا توجد أصناف بعد — أنشئ أول صنف ثم أضف منتجات له.</p>
            )}
            {sortedCategories.length > 0 && (
              <div className="contacts-erp-table-wrap">
                <table className="contacts-erp-table catalog-erp-table">
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th>عدد المنتجات</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCategories.map((category) => (
                      <tr key={category}>
                        <td>{category}</td>
                        <td>{categoryCounts.get(category) ?? 0}</td>
                        <td>
                          <Link
                            to={`/catalog/new?mode=${/عرض/i.test(category) ? "offer" : "single"}&category=${encodeURIComponent(category)}`}
                            className="contacts-erp-btn"
                          >
                            إضافة منتج
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
