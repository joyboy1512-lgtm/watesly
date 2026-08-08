import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  TEAM_PAGE_SIZE,
  computeTeamStats,
  employeeInitials,
  filterEmployees,
  formatRoleLabel,
  formatStatusLabel,
  formatWhatsAppStatus,
  getEmployeeWorkspaces,
  mapWhatsAppAccount,
  permissionSummary,
  roleBadgeClass,
  statusBadgeClass,
  workspaceDisplayName,
  buildInvitationAcceptUrl,
  type Employee,
  type InvitationResult,
  type MembershipRole,
  type Organization
} from "../lib/teamHelpers";
import { toastStore } from "../stores/toast";

export default function TeamPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("agent");
  const [organizationId, setOrganizationId] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [pendingInvite, setPendingInvite] = useState<{ email: string; url: string; expiresInHours: number } | null>(null);
  const [inviting, setInviting] = useState(false);

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const rows = (await api.get<Array<Employee & { channel_ids?: string[] }>>("/team/employees")).data;
      return rows.map((row) => ({ ...row, channel_ids: row.channel_ids ?? [] }));
    }
  });

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const whatsappQuery = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<Array<Parameters<typeof mapWhatsAppAccount>[0]>>("/whatsapp/accounts")).data
  });

  const orgMap = useMemo(
    () => new Map((organizationsQuery.data ?? []).map((item) => [item.id, item.name])),
    [organizationsQuery.data]
  );

  const workspaces = useMemo(
    () => (whatsappQuery.data ?? []).map(mapWhatsAppAccount),
    [whatsappQuery.data]
  );

  const employees = employeesQuery.data ?? [];
  const filtered = useMemo(
    () => filterEmployees(employees, workspaces, { search, role: roleFilter, status: statusFilter, workspaceId: workspaceFilter }),
    [employees, workspaces, search, roleFilter, statusFilter, workspaceFilter]
  );
  const visible = filtered.slice(0, TEAM_PAGE_SIZE);
  const stats = useMemo(() => computeTeamStats(employees), [employees]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    try {
      const response = await api.post<InvitationResult>("/team/invitations", {
        email: email.trim().toLowerCase(),
        role,
        organization_ids: [organizationId]
      });
      const inviteUrl = buildInvitationAcceptUrl(response.data.invitation_token);
      setPendingInvite({
        email: email.trim().toLowerCase(),
        url: inviteUrl,
        expiresInHours: response.data.expires_in_hours
      });
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      toastStore.getState().show("تم إنشاء الدعوة — انسخ الرابط وأرسله للموظف.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء الدعوة. تحقق من البريد والفرع وحد المستخدمين.", "error");
    } finally {
      setInviting(false);
    }
  }

  function copyInviteLink() {
    if (!pendingInvite) return;
    void navigator.clipboard.writeText(pendingInvite.url).then(() => {
      toastStore.getState().show("تم نسخ رابط الدعوة.", "success");
    });
  }

  async function toggleStatus(item: Employee) {
    await api.patch(`/team/employees/${item.membership_id}`, {
      status: item.status === "active" ? "suspended" : "active"
    });
    await queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  function renderWorkspaces(item: Employee) {
    const linked = getEmployeeWorkspaces(item, workspaces);
    if (linked.length === 0) {
      return <span className="admin-chip admin-chip-muted">لا يوجد ربط WhatsApp</span>;
    }
    return (
      <div className="admin-chip-row">
        {linked.map((workspace) => (
          <span key={workspace.id} className="admin-chip admin-chip-whatsapp" title={formatWhatsAppStatus(workspace.status)}>
            {workspaceDisplayName(workspace)}
            <small>({formatWhatsAppStatus(workspace.status)})</small>
          </span>
        ))}
      </div>
    );
  }

  function renderBranches(item: Employee) {
    if (item.organization_ids.length === 0) {
      return <span className="admin-chip admin-chip-muted">—</span>;
    }
    return (
      <div className="admin-chip-row">
        {item.organization_ids.map((orgId) => (
          <span key={orgId} className="admin-chip">{orgMap.get(orgId) ?? orgId.slice(0, 8)}</span>
        ))}
      </div>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>الموظفون</h1>
        <p>جدول شامل لبيانات الموظفين وصلاحياتهم وأفرعهم وحسابات WhatsApp Business.</p>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي الموظفين</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>نشط</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>موقوف</span><strong>{stats.suspended}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>مدراء</span><strong>{stats.admins}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>موظفو محادثات</span><strong>{stats.agents}</strong></article>
      </section>

      <section className="card form-card admin-form-card">
        <h2>دعوة موظف</h2>
        <p className="hint-text" style={{ marginBottom: 12 }}>
          لا يُرسل بريد تلقائي حالياً. بعد إنشاء الدعوة، انسخ الرابط وأرسله للموظف عبر WhatsApp أو أي وسيلة أخرى.
        </p>
        <form className="inline-form" onSubmit={invite}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" required type="email" />
          <select value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
            {INVITABLE_ROLES.map((item) => (
              <option key={item} value={item}>{formatRoleLabel(item)}</option>
            ))}
          </select>
          <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required>
            <option value="">اختر الفرع</option>
            {(organizationsQuery.data ?? []).map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          <button type="submit" disabled={inviting}>{inviting ? "جاري الإنشاء…" : "إنشاء رابط الدعوة"}</button>
        </form>

        {pendingInvite && (
          <div className="admin-invite-link-box" style={{ marginTop: 16 }}>
            <strong>رابط دعوة {pendingInvite.email}</strong>
            <small>صالح لمدة {pendingInvite.expiresInHours} ساعة — يفتح صفحة إعداد كلمة المرور.</small>
            <input value={pendingInvite.url} readOnly dir="ltr" />
            <div className="admin-actions">
              <button type="button" className="secondary-button" onClick={copyInviteLink}>نسخ الرابط</button>
              <a className="secondary-button" href={pendingInvite.url} target="_blank" rel="noreferrer">معاينة</a>
            </div>
          </div>
        )}
      </section>

      <section className="card admin-table-card">
        <div className="admin-table-header">
          <div>
            <h2>جدول الموظفين</h2>
            <small>{filtered.length} موظف · صف لكل عضو في الفريق</small>
          </div>
        </div>

        <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو البريد أو WhatsApp" />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">كل الأدوار</option>
            {INVITABLE_ROLES.map((item) => (
              <option key={item} value={item}>{formatRoleLabel(item)}</option>
            ))}
            <option value="owner">{formatRoleLabel("owner")}</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option>
          </select>
          <select value={workspaceFilter} onChange={(e) => setWorkspaceFilter(e.target.value)}>
            <option value="">كل حسابات WhatsApp</option>
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>{workspaceDisplayName(item)}</option>
            ))}
          </select>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-erp-table">
            <thead>
              <tr>
                <th>الموظف</th>
                <th>الدور</th>
                <th>الصلاحيات</th>
                <th>الفروع</th>
                <th>WhatsApp Business</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {employeesQuery.isLoading && (
                <tr><td colSpan={7} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!employeesQuery.isLoading && visible.length === 0 && (
                <tr><td colSpan={7} className="admin-table-empty">لا يوجد موظفون مطابقون للبحث.</td></tr>
              )}
              {visible.map((item) => (
                <tr key={item.membership_id}>
                  <td>
                    <div className="admin-employee-cell">
                      <div className="admin-avatar">{employeeInitials(item)}</div>
                      <div className="admin-cell-main">
                        <strong>{item.full_name}</strong>
                        <small dir="ltr">{item.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={roleBadgeClass(item.role)}>{formatRoleLabel(item.role)}</span>
                  </td>
                  <td>
                    <div className="admin-cell-stack">
                      <span>{permissionSummary(item.role)}</span>
                      <small title={ROLE_DESCRIPTIONS[item.role]}>{getRolePermissionsLabel(item.role)}</small>
                    </div>
                  </td>
                  <td>{renderBranches(item)}</td>
                  <td>{renderWorkspaces(item)}</td>
                  <td>
                    <span className={statusBadgeClass(item.status)}>{formatStatusLabel(item.status)}</span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      {item.role !== "owner" && (
                        <button type="button" className="secondary-button" onClick={() => void toggleStatus(item)}>
                          {item.status === "active" ? "تعطيل" : "تفعيل"}
                        </button>
                      )}
                    </div>
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

function getRolePermissionsLabel(role: MembershipRole): string {
  const counts: Record<MembershipRole, number> = {
    owner: 28,
    admin: 28,
    manager: 19,
    agent: 10,
    viewer: 10
  };
  return `${counts[role] ?? 0} صلاحية مفعّلة`;
}
