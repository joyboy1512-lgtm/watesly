import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  INVITABLE_ROLES,
  assignableRolesForEmployee,
  inviteableRolesForActor,
  PERMISSION_GROUPS,
  ROLE_DESCRIPTIONS,
  TEAM_PAGE_SIZE,
  canAssignPermissions,
  computeTeamStats,
  editablePermissionsForEmployee,
  employeeInitials,
  filterEmployees,
  formatRoleLabel,
  formatStatusLabel,
  formatWhatsAppStatus,
  getEmployeeWorkspaces,
  getRolePermissions,
  isBranchAdminRole,
  isBranchScopedRole,
  mapWhatsAppAccount,
  permissionSummary,
  roleBadgeClass,
  statusBadgeClass,
  workspaceDisplayName,
  buildInvitationAcceptUrl,
  type Employee,
  type InvitationResult,
  type MembershipRole,
  type Organization,
  type PermissionKey
} from "../lib/teamHelpers";
import { APP_NAV_PAGES, applyPageToggle, pageIsEnabled } from "../lib/navPermissions";
import { toastStore } from "../stores/toast";

type AddEmployeeMode = "direct" | "invite";

export default function TeamPage() {
  const queryClient = useQueryClient();
  const [addMode, setAddMode] = useState<AddEmployeeMode>("direct");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<MembershipRole>("agent");
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [pendingInvite, setPendingInvite] = useState<{ email: string; url: string; expiresInHours: number; emailSent: boolean } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [permissionEditor, setPermissionEditor] = useState<Employee | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<Set<PermissionKey>>(new Set());
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [accessEditor, setAccessEditor] = useState<Employee | null>(null);
  const [accessRoleDraft, setAccessRoleDraft] = useState<MembershipRole>("agent");
  const [accessOrgDraft, setAccessOrgDraft] = useState<Set<string>>(new Set());
  const [accessChannelDraft, setAccessChannelDraft] = useState<Set<string>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<{ permissions?: string[]; role?: string }>("/auth/me")).data
  });
  const actorPermissions = (profileQuery.data?.permissions ?? []) as PermissionKey[];
  const canManagePermissions = canAssignPermissions(actorPermissions);
  const inviteableRoles = useMemo(
    () => inviteableRolesForActor(profileQuery.data?.role, actorPermissions),
    [profileQuery.data?.role, actorPermissions]
  );

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const rows = (await api.get<Array<Employee & { channel_ids?: string[]; permissions?: string[] }>>("/team/employees")).data;
      return rows.map((row) => ({
        ...row,
        channel_ids: row.channel_ids ?? [],
        permissions: (row.permissions ?? [...getRolePermissions(row.role)]) as PermissionKey[]
      }));
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

  function toggleSelectedOrg(orgId: string) {
    setSelectedOrgIds((current) => {
      const next = current.includes(orgId)
        ? current.filter((id) => id !== orgId)
        : [...current, orgId];
      const allowedChannels = new Set(
        workspaces.filter((item) => next.includes(item.organization_id)).map((item) => item.channel_id)
      );
      setSelectedChannelIds((channels) => channels.filter((id) => allowedChannels.has(id)));
      return next;
    });
  }

  function toggleSelectedChannel(channelId: string) {
    setSelectedChannelIds((current) =>
      current.includes(channelId) ? current.filter((id) => id !== channelId) : [...current, channelId]
    );
  }

  function renderOrgChannelPicker(
    orgDraft: Set<string>,
    channelDraft: Set<string>,
    onToggleOrg: (orgId: string) => void,
    onToggleChannel: (channelId: string) => void,
    selectedRole: MembershipRole
  ) {
    return (
      <div className="admin-access-picker">
        {isBranchAdminRole(selectedRole) && (
          <div className="team-role-scope-warning" role="status">
            <strong>أدمن الفرع — حدّد الفروع المسموح بها فقط</strong>
            <p className="hint-text">
              لن يرى الموظف أي فرع غير المحدد هنا. لعزل فرع واحد، فعّل فرعاً واحداً فقط.
              لا يصل إلى الفوترة أو إعدادات النظام العامة.
            </p>
          </div>
        )}
        {isBranchScopedRole(selectedRole) && !isBranchAdminRole(selectedRole) && (
          <p className="hint-text">حدّد الفروع التي يعمل ضمنها هذا الموظف.</p>
        )}
        {(organizationsQuery.data ?? []).map((org) => {
          const orgWorkspaces = workspaces.filter((item) => item.organization_id === org.id);
          const orgSelected = orgDraft.has(org.id);
          return (
            <section key={org.id} className="admin-access-org-block">
              <label className="admin-permission-item">
                <input type="checkbox" checked={orgSelected} onChange={() => onToggleOrg(org.id)} />
                <span>{org.name}</span>
              </label>
              {orgSelected && orgWorkspaces.length > 0 && (
                <div className="admin-access-channels">
                  <small className="hint-text">بدون تحديد قناة = كل حسابات WhatsApp في هذا الفرع</small>
                  {orgWorkspaces.map((workspace) => (
                    <label key={workspace.channel_id} className="admin-permission-item">
                      <input
                        type="checkbox"
                        checked={channelDraft.has(workspace.channel_id)}
                        onChange={() => onToggleChannel(workspace.channel_id)}
                      />
                      <span>{workspaceDisplayName(workspace)}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!selectedOrgIds.length) {
      toastStore.getState().show("اختر فرعاً واحداً على الأقل.", "error");
      return;
    }
    setInviting(true);
    try {
      const response = await api.post<InvitationResult>("/team/invitations", {
        email: email.trim().toLowerCase(),
        role,
        organization_ids: selectedOrgIds,
        channel_ids: selectedChannelIds
      });
      const inviteUrl = response.data.invitation_accept_url || buildInvitationAcceptUrl(response.data.invitation_token);
      const emailSent = response.data.email_sent;
      setPendingInvite({
        email: email.trim().toLowerCase(),
        url: inviteUrl,
        expiresInHours: response.data.expires_in_hours,
        emailSent
      });
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      toastStore.getState().show(
        emailSent
          ? `تم إرسال الدعوة إلى ${email.trim().toLowerCase()}.`
          : "تم إنشاء الدعوة. انسخ الرابط — لم يُرسل بريد (SMTP غير مفعّل أو فشل الإرسال).",
        "success"
      );
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

  async function createDirect(event: FormEvent) {
    event.preventDefault();
    if (!selectedOrgIds.length) {
      toastStore.getState().show("اختر فرعاً واحداً على الأقل.", "error");
      return;
    }
    if (password.length < 6) {
      toastStore.getState().show("كلمة المرور يجب أن تكون 6 أحرف على الأقل.", "error");
      return;
    }
    if (password !== confirmPassword) {
      toastStore.getState().show("كلمتا المرور غير متطابقتين.", "error");
      return;
    }

    setCreating(true);
    const createdName = fullName.trim();
    try {
      await api.post("/team/employees", {
        email: email.trim().toLowerCase(),
        full_name: createdName,
        password,
        role,
        organization_ids: selectedOrgIds,
        channel_ids: selectedChannelIds,
        preferred_language: "ar"
      });
      setEmail("");
      setFullName("");
      setPassword("");
      setConfirmPassword("");
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      toastStore.getState().show(
        `تم إنشاء حساب ${createdName}. شارك البريد وكلمة المرور مع الموظف (مثلاً عبر WhatsApp).`,
        "success"
      );
    } catch {
      toastStore.getState().show("تعذر إنشاء الحساب. تحقق من البيانات أو أن البريد غير مستخدم مسبقاً.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(item: Employee) {
    await api.patch(`/team/employees/${item.membership_id}`, {
      status: item.status === "active" ? "suspended" : "active"
    });
    await queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  function openPermissionEditor(item: Employee) {
    setPermissionEditor(item);
    setPermissionDraft(new Set((item.permissions.length ? item.permissions : [...getRolePermissions(item.role)]) as PermissionKey[]));
  }

  function togglePermissionDraft(key: PermissionKey) {
    setPermissionDraft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openAccessEditor(item: Employee) {
    setAccessEditor(item);
    setAccessRoleDraft(item.role);
    setAccessOrgDraft(new Set(item.organization_ids));
    setAccessChannelDraft(new Set(item.channel_ids));
  }

  function toggleAccessOrg(orgId: string) {
    setAccessOrgDraft((current) => {
      const next = new Set(current);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      const allowedChannels = new Set(
        workspaces.filter((item) => next.has(item.organization_id)).map((item) => item.channel_id)
      );
      setAccessChannelDraft((channels) => {
        const filtered = new Set([...channels].filter((id) => allowedChannels.has(id)));
        return filtered;
      });
      return next;
    });
  }

  function toggleAccessChannel(channelId: string) {
    setAccessChannelDraft((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  async function saveAccess() {
    if (!accessEditor) return;
    if (accessOrgDraft.size === 0) {
      toastStore.getState().show("اختر فرعاً واحداً على الأقل.", "error");
      return;
    }
    setSavingAccess(true);
    try {
      await api.patch(`/team/employees/${accessEditor.membership_id}`, {
        role: accessRoleDraft,
        organization_ids: [...accessOrgDraft],
        channel_ids: [...accessChannelDraft]
      });
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      setAccessEditor(null);
      toastStore.getState().show("تم تحديث الوصول للفروع وحسابات WhatsApp.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ الوصول. تحقق من الفروع والقنوات.", "error");
    } finally {
      setSavingAccess(false);
    }
  }

  async function savePermissions() {
    if (!permissionEditor) return;
    setSavingPermissions(true);
    try {
      await api.patch(`/team/employees/${permissionEditor.membership_id}`, {
        permissions: [...permissionDraft]
      });
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      setPermissionEditor(null);
      toastStore.getState().show("تم تحديث صلاحيات الموظف.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ الصلاحيات.", "error");
    } finally {
      setSavingPermissions(false);
    }
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

      {canManagePermissions && inviteableRoles.includes("branch_admin") && (
        <section className="card team-role-guide-card">
          <h2>أدمن الفرع</h2>
          <p className="hint-text">
            لتعيين موظف كـ <strong>أدمن فرع واحد فقط</strong>: اختر الدور «أدمن الفرع» ثم حدّد الفرع المطلوب فقط.
            لن يرى الفوترة أو الأفرع الأخرى أو منصة المطور.
          </p>
        </section>
      )}

      {canManagePermissions && (
      <section className="card form-card admin-form-card">
        <div className="admin-form-card-header">
          <h2>إضافة موظف</h2>
          <div className="admin-mode-tabs">
            <button
              type="button"
              className={addMode === "direct" ? "admin-mode-tab active" : "admin-mode-tab"}
              onClick={() => setAddMode("direct")}
            >
              إنشاء مباشر
            </button>
            <button
              type="button"
              className={addMode === "invite" ? "admin-mode-tab active" : "admin-mode-tab"}
              onClick={() => setAddMode("invite")}
            >
              رابط دعوة
            </button>
          </div>
        </div>

        {addMode === "direct" ? (
          <>
            <p className="hint-text" style={{ marginBottom: 12 }}>
              أنشئ حساباً فوراً بدون بريد إلكتروني. حدّد كلمة المرور وشاركها مع الموظف يدوياً (WhatsApp أو أي قناة).
            </p>
            <form className="inline-form" onSubmit={createDirect}>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="الاسم الكامل" required minLength={2} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" required type="email" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" required type="password" minLength={6} autoComplete="new-password" />
              <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="تأكيد كلمة المرور" required type="password" minLength={6} autoComplete="new-password" />
              <select value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
                {inviteableRoles.map((item) => (
                  <option key={item} value={item}>{formatRoleLabel(item)}</option>
                ))}
              </select>
              <p className="hint-text">{ROLE_DESCRIPTIONS[role]}</p>
              {renderOrgChannelPicker(
                new Set(selectedOrgIds),
                new Set(selectedChannelIds),
                toggleSelectedOrg,
                toggleSelectedChannel,
                role
              )}
              <button type="submit" disabled={creating}>{creating ? "جاري الإنشاء…" : "إنشاء الحساب"}</button>
            </form>
          </>
        ) : (
          <>
            <p className="hint-text" style={{ marginBottom: 12 }}>
              يُرسل رابط الدعوة تلقائياً إلى البريد عند تفعيل SMTP. بدون SMTP، انسخ الرابط الاحتياطي وأرسله يدوياً.
            </p>
            <form className="inline-form" onSubmit={invite}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" required type="email" />
              <select value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
                {inviteableRoles.map((item) => (
                  <option key={item} value={item}>{formatRoleLabel(item)}</option>
                ))}
              </select>
              <p className="hint-text">{ROLE_DESCRIPTIONS[role]}</p>
              {renderOrgChannelPicker(
                new Set(selectedOrgIds),
                new Set(selectedChannelIds),
                toggleSelectedOrg,
                toggleSelectedChannel,
                role
              )}
              <button type="submit" disabled={inviting}>{inviting ? "جاري الإرسال…" : "إرسال الدعوة"}</button>
            </form>

            {pendingInvite && (
              <div className="admin-invite-link-box" style={{ marginTop: 16 }}>
                <strong>
                  {pendingInvite.emailSent ? `تم إرسال الدعوة إلى ${pendingInvite.email}` : `رابط احتياطي — ${pendingInvite.email}`}
                </strong>
                <small>
                  {pendingInvite.emailSent
                    ? `صالح لمدة ${pendingInvite.expiresInHours} ساعة. إذا لم يصل البريد، انسخ الرابط أدناه.`
                    : `SMTP غير مفعّل أو فشل الإرسال — انسخ الرابط وأرسله يدوياً (صالح ${pendingInvite.expiresInHours} ساعة).`}
                </small>
                <input value={pendingInvite.url} readOnly dir="ltr" />
                <div className="admin-actions">
                  <button type="button" className="secondary-button" onClick={copyInviteLink}>نسخ الرابط</button>
                  <a className="secondary-button" href={pendingInvite.url} target="_blank" rel="noreferrer">معاينة</a>
                </div>
              </div>
            )}
          </>
        )}
      </section>
      )}

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
                      {canManagePermissions && item.role !== "owner" && (
                        <>
                          <button type="button" className="secondary-button" onClick={() => openAccessEditor(item)}>
                            الدور والفرع
                          </button>
                          <button type="button" className="secondary-button" onClick={() => openPermissionEditor(item)}>
                            صلاحيات
                          </button>
                        </>
                      )}
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

      {accessEditor && (
        <div className="modal-overlay" onClick={() => setAccessEditor(null)}>
          <div className="modal-card admin-permissions-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>الدور والوصول للفروع</h2>
                <small>{accessEditor.full_name}</small>
              </div>
              <button type="button" className="secondary-button" onClick={() => setAccessEditor(null)}>إغلاق</button>
            </header>
            <label className="field-label">
              <span>دور الموظف</span>
              <select
                value={accessRoleDraft}
                onChange={(e) => setAccessRoleDraft(e.target.value as MembershipRole)}
                disabled={accessEditor.role === "owner"}
              >
                {assignableRolesForEmployee(profileQuery.data?.role, accessEditor.role, actorPermissions).map((item) => (
                  <option key={item} value={item}>{formatRoleLabel(item)}</option>
                ))}
              </select>
            </label>
            <p className="hint-text">{ROLE_DESCRIPTIONS[accessRoleDraft]}</p>
            {renderOrgChannelPicker(
              accessOrgDraft,
              accessChannelDraft,
              toggleAccessOrg,
              toggleAccessChannel,
              accessRoleDraft
            )}
            <div className="admin-actions" style={{ marginTop: 16 }}>
              <button type="button" disabled={savingAccess} onClick={() => void saveAccess()}>
                {savingAccess ? "جاري الحفظ…" : "حفظ الدور والوصول"}
              </button>
            </div>
          </div>
        </div>
      )}

      {permissionEditor && (
        <div className="modal-overlay" onClick={() => setPermissionEditor(null)}>
          <div className="modal-card admin-permissions-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>صلاحيات الوصول</h2>
                <small>{permissionEditor.full_name} · {formatRoleLabel(permissionEditor.role)}</small>
              </div>
              <button type="button" className="secondary-button" onClick={() => setPermissionEditor(null)}>إغلاق</button>
            </header>
            <p className="hint-text">حدّد الصفحات التي يراها الموظف في القائمة. لوحة التحكم تظهر دائماً. الصفحات غير المفعّلة تُحجب من القائمة ولا يمكن فتحها.</p>
            <div className="admin-permissions-grid admin-pages-grid">
              {APP_NAV_PAGES.filter((page) => {
                const rule = page.permission;
                if (rule === null) return false;
                const keys = Array.isArray(rule) ? rule : [rule];
                return keys.every((key) => editablePermissionsForEmployee(permissionEditor.role, actorPermissions).includes(key));
              }).map((page) => (
                <label key={page.path} className="admin-permission-item admin-page-item">
                  <input
                    type="checkbox"
                    checked={pageIsEnabled(permissionDraft, page.permission)}
                    onChange={(event) => setPermissionDraft(applyPageToggle(permissionDraft, page.permission, event.target.checked))}
                  />
                  <span>{page.label}</span>
                </label>
              ))}
            </div>
            <details className="admin-permissions-advanced">
              <summary>صلاحيات تفصيلية (متقدم)</summary>
              <div className="admin-permissions-grid">
                {PERMISSION_GROUPS.map((group) => {
                  const options = group.permissions.filter((item) =>
                    editablePermissionsForEmployee(permissionEditor.role, actorPermissions).includes(item.key)
                  );
                  if (options.length === 0) return null;
                  return (
                    <section key={group.id} className="admin-permissions-group">
                      <h3>{group.label}</h3>
                      <div className="admin-permissions-list">
                        {options.map((item) => (
                          <label key={item.key} className="admin-permission-item">
                            <input
                              type="checkbox"
                              checked={permissionDraft.has(item.key)}
                              onChange={() => togglePermissionDraft(item.key)}
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </details>
            <div className="admin-actions" style={{ marginTop: 16 }}>
              <button type="button" className="secondary-button" onClick={() => setPermissionDraft(new Set(getRolePermissions(permissionEditor.role)))}>
                افتراضي الدور
              </button>
              <button type="button" disabled={savingPermissions} onClick={() => void savePermissions()}>
                {savingPermissions ? "جاري الحفظ…" : "حفظ الصلاحيات"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function getRolePermissionsLabel(role: MembershipRole): string {
  return `${getRolePermissions(role).size} صلاحية مفعّلة`;
}
