import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatOrgStatus, orgStatusClass, organizationCreateErrorMessage, slugFromName } from "../lib/orgHelpers";
import { formatPlanLimit } from "../lib/planLimits";
import { toastStore } from "../stores/toast";

type Organization = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  currency_code: string;
  timezone: string;
  default_language: string;
  status: string;
  max_users: number;
  max_channels: number;
  active_member_count: number;
  active_channel_count: number;
};

type OrganizationCreateResponse = Organization & {
  branch_admin_invitation_sent?: boolean;
  branch_admin_email?: string | null;
};

function parseOptionalLimit(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export default function OrganizationsPage() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxChannels, setMaxChannels] = useState("");
  const [branchAdminEmail, setBranchAdminEmail] = useState("");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

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
      channels: rows.reduce((sum, item) => sum + (item.active_channel_count ?? 0), 0)
    };
  }, [query.data]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const nextSlug = (slug || slugFromName(name)).trim();
    if (nextSlug.length < 2) {
      toastStore.getState().show("أدخل معرّف فرع بالإنجليزية (مثل three-shiny).", "error");
      return;
    }
    const adminEmail = branchAdminEmail.trim().toLowerCase();
    try {
      const result = await api.post<OrganizationCreateResponse>("/organizations", {
        name: name.trim(),
        slug: nextSlug,
        country_code: "KW",
        currency_code: "KWD",
        timezone: "Asia/Kuwait",
        default_language: "ar",
        max_users: parseOptionalLimit(maxUsers),
        max_channels: parseOptionalLimit(maxChannels),
        branch_admin_email: adminEmail || null
      });
      setName("");
      setSlug("");
      setMaxUsers("");
      setMaxChannels("");
      setBranchAdminEmail("");
      await client.invalidateQueries({ queryKey: ["organizations"] });
      if (adminEmail) {
        toastStore.getState().show(
          result.data.branch_admin_invitation_sent
            ? `تم إنشاء الفرع وإرسال دعوة مدير الفرع إلى ${adminEmail}.`
            : `تم إنشاء الفرع. أرسل رابط الدعوة يدوياً إلى ${adminEmail}.`,
          "success"
        );
      } else {
        toastStore.getState().show("تم إضافة الفرع.", "success");
      }
    } catch (error) {
      toastStore.getState().show(organizationCreateErrorMessage(error), "error");
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>الفروع</h1>
        <p>أنشئ فرعاً جديداً مع حدود المستخدمين والقنوات ودعوة مدير الفرع.</p>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي الفروع</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>فروع نشطة</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>قنوات مرتبطة</span><strong>{stats.channels}</strong></article>
      </section>

      <section className="card form-card admin-form-card">
        <h2>إضافة فرع</h2>
        <form className="stack-form" onSubmit={create}>
          <div className="inline-form">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) setSlug(slugFromName(e.target.value));
              }}
              placeholder="اسم الفرع"
              required
            />
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="three-shiny" required />
          </div>
          <p className="hint-text" style={{ margin: 0 }}>
            المعرّف بالإنجليزية (حروف صغيرة وأرقام وشرطة). إن كان اسم الفرع عربياً، عدّله يدوياً.
          </p>
          <div className="inline-form">
            <label className="field-label">
              <span>حد المستخدمين للفرع</span>
              <input
                type="number"
                min={0}
                value={maxUsers}
                onChange={(e) => setMaxUsers(e.target.value)}
                placeholder="0 = غير محدود"
              />
            </label>
            <label className="field-label">
              <span>حد القنوات للفرع</span>
              <input
                type="number"
                min={0}
                value={maxChannels}
                onChange={(e) => setMaxChannels(e.target.value)}
                placeholder="0 = غير محدود"
              />
            </label>
            <label className="field-label">
              <span>بريد مدير الفرع</span>
              <input
                type="email"
                value={branchAdminEmail}
                onChange={(e) => setBranchAdminEmail(e.target.value)}
                placeholder="admin@example.com"
                dir="ltr"
              />
            </label>
          </div>
          <p className="hint-text" style={{ margin: 0 }}>
            سيُرسَل لمدير الفرع دعوة بصلاحية «مدير فرع» لإدارة هذا الفرع فقط.
          </p>
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
                <th>المستخدمون</th>
                <th>القنوات</th>
                <th>حد المستخدمين</th>
                <th>حد القنوات</th>
                <th>الدولة</th>
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
                  <td>{item.active_member_count ?? 0}</td>
                  <td>{item.active_channel_count ?? 0}</td>
                  <td>{formatPlanLimit(item.max_users ?? 0)}</td>
                  <td>{formatPlanLimit(item.max_channels ?? 0)}</td>
                  <td>{item.country_code}</td>
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
