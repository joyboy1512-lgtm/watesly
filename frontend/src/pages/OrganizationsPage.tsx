import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatOrgStatus, orgStatusClass, slugFromName } from "../lib/orgHelpers";

type Organization = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  currency_code: string;
  timezone: string;
  default_language: string;
  status: string;
};

type Channel = { id: string; organization_id: string };

export default function OrganizationsPage() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });

  const channelCountByOrg = useMemo(() => {
    const map = new Map<string, number>();
    for (const channel of channelsQuery.data ?? []) {
      map.set(channel.organization_id, (map.get(channel.organization_id) ?? 0) + 1);
    }
    return map;
  }, [channelsQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) ||
        item.slug.toLowerCase().includes(term) ||
        item.country_code.toLowerCase().includes(term)
      );
    });
  }, [query.data, search]);

  const stats = useMemo(() => {
    const rows = query.data ?? [];
    return {
      total: rows.length,
      active: rows.filter((item) => item.status === "active").length,
      channels: (channelsQuery.data ?? []).length
    };
  }, [query.data, channelsQuery.data]);

  async function create(event: FormEvent) {
    event.preventDefault();
    await api.post("/organizations", {
      name,
      slug: slug || slugFromName(name),
      country_code: "KW",
      currency_code: "KWD",
      timezone: "Asia/Kuwait",
      default_language: "ar"
    });
    setName("");
    setSlug("");
    client.invalidateQueries({ queryKey: ["organizations"] });
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>الفروع</h1>
        <p>جدول منظم لكل فرع مع بياناته التشغيلية وعدد القنوات المرتبطة.</p>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي الفروع</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>فروع نشطة</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>قنوات مرتبطة</span><strong>{stats.channels}</strong></article>
      </section>

      <section className="card form-card admin-form-card">
        <h2>إضافة فرع</h2>
        <form className="inline-form" onSubmit={create}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) setSlug(slugFromName(e.target.value));
            }}
            placeholder="اسم الفرع"
            required
          />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="branch-kuwait" required />
          <button type="submit">إضافة فرع</button>
        </form>
      </section>

      <section className="card admin-table-card">
        <div className="admin-table-header">
          <div>
            <h2>جدول الفروع</h2>
            <small>{filtered.length} فرع · صف لكل فرع</small>
          </div>
          <Link to="/channels" className="admin-table-link">إدارة القنوات ←</Link>
        </div>

        <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو المعرف أو الدولة" />
        </div>

        <div className="admin-table-wrap">
          <table className="admin-erp-table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th>المعرف</th>
                <th>الدولة</th>
                <th>العملة</th>
                <th>المنطقة الزمنية</th>
                <th>اللغة</th>
                <th>القنوات</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={8} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!query.isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="admin-table-empty">لا توجد فروع.</td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="admin-cell-main">
                      <strong>{item.name}</strong>
                      <small>{item.id.slice(0, 8)}…</small>
                    </div>
                  </td>
                  <td dir="ltr">{item.slug}</td>
                  <td>{item.country_code}</td>
                  <td>{item.currency_code}</td>
                  <td dir="ltr">{item.timezone}</td>
                  <td>{item.default_language === "ar" ? "العربية" : item.default_language}</td>
                  <td>
                    <span className="admin-chip">{channelCountByOrg.get(item.id) ?? 0} قناة</span>
                  </td>
                  <td>
                    <span className={orgStatusClass(item.status)}>{formatOrgStatus(item.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
