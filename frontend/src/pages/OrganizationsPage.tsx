import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCurrentUser } from "../hooks/usePermissions";
import {
  formatOrgStatus,
  orgStatusClass,
  organizationCreateErrorMessage,
  organizationUpdateErrorMessage,
  slugFromName
} from "../lib/orgHelpers";
import { formatPlanLimit } from "../lib/planLimits";
import { isAccountManager } from "../lib/teamHelpers";
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

function limitInputValue(limit: number): string {
  return limit > 0 ? String(limit) : "";
}

export default function OrganizationsPage() {
  const client = useQueryClient();
  const profile = useCurrentUser();
  const canManageAccountBranches = isAccountManager(profile.data?.role);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxChannels, setMaxChannels] = useState("");
  const [branchAdminEmail, setBranchAdminEmail] = useState("");
  const [search, setSearch] = useState("");
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editMaxUsers, setEditMaxUsers] = useState("");
  const [editMaxChannels, setEditMaxChannels] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingStatusId, setTogglingStatusId] = useState<string | null>(null);

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
      suspended: rows.filter((item) => item.status === "suspended").length,
      channels: rows.reduce((sum, item) => sum + (item.active_channel_count ?? 0), 0)
    };
  }, [query.data]);

  function openEdit(org: Organization) {
    setEditingOrg(org);
    setEditMaxUsers(limitInputValue(org.max_users ?? 0));
    setEditMaxChannels(limitInputValue(org.max_channels ?? 0));
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingOrg) return;
    setSavingEdit(true);
    try {
      await api.patch(`/organizations/${editingOrg.id}`, {
        max_users: parseOptionalLimit(editMaxUsers),
        max_channels: parseOptionalLimit(editMaxChannels)
      });
      await client.invalidateQueries({ queryKey: ["organizations"] });
      toastStore.getState().show("تم تحديث حدود الفرع.", "success");
      setEditingOrg(null);
    } catch (error) {
      toastStore.getState().show(organizationUpdateErrorMessage(error), "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleBranchStatus(org: Organization) {
    const suspending = org.status === "active";
    const prompt = suspending
      ? `إيقاف فرع «${org.name}»؟ لن يتمكن موظفو الفرع من الوصول فوراً.`
      : `تفعيل فرع «${org.name}» واستعادة الوصول؟`;
    if (!window.confirm(prompt)) return;

    setTogglingStatusId(org.id);
    try {
      await api.patch(`/organizations/${org.id}`, {
        status: suspending ? "suspended" : "active"
      });
      await client.invalidateQueries({ queryKey: ["organizations"] });
      toastStore.getState().show(
        suspending ? `تم إيقاف فرع «${org.name}».` : `تم تفعيل فرع «${org.name}».`,
        "success"
      );
    } catch (error) {
      toastStore.getState().show(organizationUpdateErrorMessage(error), "error");
    } finally {
      setTogglingStatusId(null);
    }
  }

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
        <p>
          {canManageAccountBranches
            ? "أنشئ فرعاً جديداً، عدّل حدود المستخدمين والقنوات، أو أوقف الوصول للفرع فوراً."
            : "عرض الفروع المرتبطة بصلاحياتك. إدارة الموظفين والقنوات تتم من صفحات الفريق والقنوات."}
        </p>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي الفروع</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>فروع نشطة</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>فروع موقوفة</span><strong>{stats.suspended}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>قنوات مرتبطة</span><strong>{stats.channels}</strong></article>
      </section>

      {canManageAccountBranches && (
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
      )}

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
                {canManageAccountBranches && <th>إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={canManageAccountBranches ? 9 : 8} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!query.isLoading && filtered.length === 0 && (
                <tr><td colSpan={canManageAccountBranches ? 9 : 8} className="admin-table-empty">لا توجد فروع.</td></tr>
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
                  {canManageAccountBranches && (
                  <td>
                    <div className="admin-actions compact">
                      <button type="button" className="secondary-button" onClick={() => openEdit(item)}>
                        تعديل الحدود
                      </button>
                      <button
                        type="button"
                        className={`secondary-button compact${item.status === "active" ? " danger-text" : ""}`}
                        disabled={togglingStatusId === item.id}
                        onClick={() => void toggleBranchStatus(item)}
                      >
                        {togglingStatusId === item.id
                          ? "جاري…"
                          : item.status === "active"
                            ? "إيقاف الفرع"
                            : "تفعيل الفرع"}
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingOrg && (
        <div className="catalog-edit-overlay" role="dialog" aria-modal="true">
          <button type="button" className="catalog-edit-backdrop" aria-label="إغلاق" onClick={() => setEditingOrg(null)} />
          <form className="catalog-edit-panel stack-form" onSubmit={saveEdit}>
            <div className="catalog-edit-head">
              <h3>تعديل حدود: {editingOrg.name}</h3>
              <button type="button" className="panel-close" onClick={() => setEditingOrg(null)}>×</button>
            </div>
            <p className="hint-text">
              الاستخدام الحالي: {editingOrg.active_member_count ?? 0} مستخدم · {editingOrg.active_channel_count ?? 0} قناة
            </p>
            <div className="inline-form">
              <label className="field-label">
                <span>حد المستخدمين</span>
                <input
                  type="number"
                  min={0}
                  value={editMaxUsers}
                  onChange={(e) => setEditMaxUsers(e.target.value)}
                  placeholder="0 = غير محدود"
                />
              </label>
              <label className="field-label">
                <span>حد القنوات</span>
                <input
                  type="number"
                  min={0}
                  value={editMaxChannels}
                  onChange={(e) => setEditMaxChannels(e.target.value)}
                  placeholder="0 = غير محدود"
                />
              </label>
            </div>
            <p className="hint-text" style={{ margin: 0 }}>
              لا يمكن وضع حد أقل من العدد الحالي للمستخدمين أو القنوات.
            </p>
            <div className="catalog-card-actions">
              <button type="submit" className="whatsapp-button" disabled={savingEdit}>
                {savingEdit ? "جاري الحفظ…" : "حفظ التعديلات"}
              </button>
              <button type="button" className="secondary-button" onClick={() => setEditingOrg(null)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
