import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  type AssignmentRule,
  type AssignmentStrategy,
  type AssignmentTeam,
  type WorkloadRow,
  channelsForBranch,
  employeesForBranch,
  formatStrategy,
  teamsForBranch
} from "../lib/assignmentHelpers";
import { employeeInitials, formatRoleLabel, type Employee } from "../lib/teamHelpers";
import { toastStore } from "../stores/toast";

type Organization = { id: string; name: string };
type Channel = { id: string; name: string; organization_id: string };

export default function AssignmentsPage() {
  const client = useQueryClient();
  const [branchFilter, setBranchFilter] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [teamId, setTeamId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [strategy, setStrategy] = useState<AssignmentStrategy>("round_robin");
  const [rulePriority, setRulePriority] = useState(100);
  const [editingTeam, setEditingTeam] = useState<AssignmentTeam | null>(null);
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await api.get<Employee[]>("/team/employees")).data
  });
  const teams = useQuery({
    queryKey: ["assignment-teams"],
    queryFn: async () => (await api.get<AssignmentTeam[]>("/assignments/teams")).data
  });
  const rules = useQuery({
    queryKey: ["assignment-rules"],
    queryFn: async () => (await api.get<AssignmentRule[]>("/assignments/rules")).data
  });
  const workload = useQuery({
    queryKey: ["team-workload"],
    queryFn: async () => (await api.get<WorkloadRow[]>("/platform/team/workload")).data
  });

  const orgMap = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data]
  );
  const teamMap = useMemo(
    () => new Map((teams.data ?? []).map((item) => [item.id, item.name])),
    [teams.data]
  );
  const channelMap = useMemo(
    () => new Map((channels.data ?? []).map((item) => [item.id, item.name])),
    [channels.data]
  );
  const employeeMap = useMemo(
    () => new Map((employees.data ?? []).map((item) => [item.membership_id, item])),
    [employees.data]
  );

  const visibleTeams = useMemo(
    () => teamsForBranch(teams.data ?? [], branchFilter),
    [teams.data, branchFilter]
  );
  const visibleRules = useMemo(() => {
    const rows = rules.data ?? [];
    if (!branchFilter) return rows;
    return rows.filter((item) => item.organization_id === branchFilter);
  }, [rules.data, branchFilter]);

  const branchEmployees = useMemo(
    () => employeesForBranch(employees.data ?? [], organizationId),
    [employees.data, organizationId]
  );
  const ruleTeamOrgId = teams.data?.find((t) => t.id === teamId)?.organization_id ?? "";

  const stats = useMemo(() => ({
    teams: visibleTeams.length,
    rules: visibleRules.filter((item) => item.is_active).length,
    members: visibleTeams.reduce((sum, item) => sum + item.membership_ids.length, 0)
  }), [visibleTeams, visibleRules]);

  const workloadRows = useMemo(() => {
    return (workload.data ?? [])
      .map((row) => ({
        ...row,
        employee: employeeMap.get(row.membership_id)
      }))
      .filter((row) => !branchFilter || (row.employee?.organization_ids ?? []).includes(branchFilter))
      .sort((a, b) => b.open_conversations - a.open_conversations);
  }, [workload.data, employeeMap, branchFilter]);

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    try {
      await api.post("/assignments/teams", {
        organization_id: organizationId,
        name: teamName.trim(),
        description: null,
        membership_ids: selectedMembers
      });
      setTeamName("");
      setSelectedMembers([]);
      await client.invalidateQueries({ queryKey: ["assignment-teams"] });
      toastStore.getState().show("تم إنشاء الفريق.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء الفريق. تأكد أن الأعضاء من نفس الفرع.", "error");
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    const team = (teams.data ?? []).find((item) => item.id === teamId);
    if (!team) return;
    try {
      await api.post("/assignments/rules", {
        organization_id: team.organization_id,
        channel_id: channelId || null,
        team_id: teamId,
        name: `توزيع ${team.name}`,
        strategy,
        priority: rulePriority,
        is_active: true
      });
      setChannelId("");
      await client.invalidateQueries({ queryKey: ["assignment-rules"] });
      toastStore.getState().show("تم حفظ قاعدة التوزيع.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ القاعدة.", "error");
    }
  }

  function openTeamEditor(team: AssignmentTeam) {
    setEditingTeam(team);
    setEditMembers([...team.membership_ids]);
  }

  async function saveTeamMembers() {
    if (!editingTeam) return;
    setSavingTeam(true);
    try {
      await api.patch(`/assignments/teams/${editingTeam.id}`, { membership_ids: editMembers });
      await client.invalidateQueries({ queryKey: ["assignment-teams"] });
      setEditingTeam(null);
      toastStore.getState().show("تم تحديث أعضاء الفريق.", "success");
    } catch {
      toastStore.getState().show("تعذر تحديث الفريق.", "error");
    } finally {
      setSavingTeam(false);
    }
  }

  async function deleteTeamItem(team: AssignmentTeam) {
    if (!window.confirm(`حذف فريق «${team.name}» وجميع قواعده؟`)) return;
    try {
      await api.delete(`/assignments/teams/${team.id}`);
      await client.invalidateQueries({ queryKey: ["assignment-teams"] });
      await client.invalidateQueries({ queryKey: ["assignment-rules"] });
      toastStore.getState().show("تم حذف الفريق.", "success");
    } catch {
      toastStore.getState().show("تعذر حذف الفريق.", "error");
    }
  }

  async function toggleRule(rule: AssignmentRule) {
    await api.patch(`/assignments/rules/${rule.id}`, { is_active: !rule.is_active });
    await client.invalidateQueries({ queryKey: ["assignment-rules"] });
  }

  async function deleteRuleItem(rule: AssignmentRule) {
    if (!window.confirm(`حذف قاعدة «${rule.name}»؟`)) return;
    await api.delete(`/assignments/rules/${rule.id}`);
    await client.invalidateQueries({ queryKey: ["assignment-rules"] });
    toastStore.getState().show("تم حذف القاعدة.", "success");
  }

  function renderMemberChips(membershipIds: string[]) {
    if (membershipIds.length === 0) {
      return <span className="admin-chip admin-chip-muted">لا يوجد أعضاء</span>;
    }
    return (
      <div className="admin-chip-row">
        {membershipIds.map((id) => {
          const employee = employeeMap.get(id);
          return (
            <span key={id} className="admin-chip">
              {employee?.full_name ?? id.slice(0, 8)}
            </span>
          );
        })}
      </div>
    );
  }

  function workloadBadgeClass(count: number): string {
    if (count >= 8) return "assignments-load-badge assignments-load-high";
    if (count >= 4) return "assignments-load-badge assignments-load-medium";
    return "assignments-load-badge assignments-load-low";
  }

  return (
    <main className="page assignments-page">
      <header className="page-header assignments-hero">
        <div>
          <span className="assignments-eyebrow">إدارة التشغيل</span>
          <h1>الفرق والتوزيع</h1>
          <p>أنشئ فرق التوزيع لكل فرع، وحدّد كيف تُوزَّع المحادثات الواردة تلقائياً على الموظفين.</p>
        </div>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>فرق التوزيع</span><strong>{stats.teams}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>قواعد نشطة</span><strong>{stats.rules}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>أعضاء الفرق</span><strong>{stats.members}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>محادثات مفتوحة</span><strong>{workloadRows.reduce((s, r) => s + r.open_conversations, 0)}</strong></article>
      </section>

      <section className="card assignments-filter-card">
        <div className="assignments-filter-bar">
          <div>
            <strong>تصفية حسب الفرع</strong>
            <small>اعرض فرق وقواعد فرع محدد</small>
          </div>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">كل الأفرع</option>
            {(organizations.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="assignments-forms-grid">
        <article className="card form-card admin-form-card assignments-form-card">
          <div className="assignments-form-head">
            <h2>إنشاء فريق توزيع</h2>
            <span className="assignments-form-step">1</span>
          </div>
          <p className="hint-text">اختر الفرع ثم حدّد موظفيه النشطين فقط.</p>
          <form className="stack-form" onSubmit={createTeam}>
            <select value={organizationId} onChange={(e) => { setOrganizationId(e.target.value); setSelectedMembers([]); }} required>
              <option value="">اختر الفرع</option>
              {(organizations.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="اسم الفريق (مثال: فريق المبيعات)" required />
            <div className="contact-picker assignments-member-picker admin-permissions-list">
              {branchEmployees.length === 0 && organizationId && (
                <small className="hint-text">لا يوجد موظفون نشطون في هذا الفرع.</small>
              )}
              {branchEmployees.map((item) => (
                <label key={item.membership_id} className="admin-permission-item">
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(item.membership_id)}
                    onChange={(e) =>
                      setSelectedMembers((current) =>
                        e.target.checked
                          ? [...current, item.membership_id]
                          : current.filter((id) => id !== item.membership_id)
                      )
                    }
                  />
                  <span>{item.full_name} · {formatRoleLabel(item.role)}</span>
                </label>
              ))}
            </div>
            <button className="assignments-primary-btn" type="submit" disabled={!organizationId || selectedMembers.length === 0}>إنشاء الفريق</button>
          </form>
        </article>

        <article className="card form-card admin-form-card assignments-form-card">
          <div className="assignments-form-head">
            <h2>قاعدة توزيع تلقائي</h2>
            <span className="assignments-form-step">2</span>
          </div>
          <p className="hint-text">تُطبَّق على المحادثات الجديدة حسب الفرع والقناة.</p>
          <form className="stack-form" onSubmit={createRule}>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              <option value="">اختر فريق التوزيع</option>
              {(teams.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name} ({orgMap.get(item.organization_id) ?? "—"})</option>
              ))}
            </select>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">كل قنوات WhatsApp في الفرع</option>
              {channelsForBranch(channels.data ?? [], ruleTeamOrgId).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as AssignmentStrategy)}>
              <option value="round_robin">توزيع بالتناوب</option>
              <option value="least_open">الأقل محادثات مفتوحة (ضمن الفرع)</option>
            </select>
            <label className="field-label">
              <span>الأولوية (أقل = أسبق)</span>
              <input type="number" min={1} max={1000} value={rulePriority} onChange={(e) => setRulePriority(Number(e.target.value))} />
            </label>
            <button className="assignments-primary-btn" type="submit" disabled={!teamId}>حفظ القاعدة</button>
          </form>
        </article>
      </section>

      <section className="card admin-table-card assignments-table-card">
        <div className="admin-table-header assignments-table-title">
          <div>
            <h2>حمل الموظفين الآن</h2>
            <small>عدد المحادثات المفتوحة/المعلّقة لكل موظف</small>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table assignments-erp-table">
            <thead>
              <tr>
                <th className="th-brand">الموظف</th>
                <th>الدور</th>
                <th className="th-brand">محادثات مفتوحة</th>
              </tr>
            </thead>
            <tbody>
              {workloadRows.length === 0 && (
                <tr><td colSpan={3} className="admin-table-empty">لا توجد بيانات حمل.</td></tr>
              )}
              {workloadRows.map((row) => (
                <tr key={row.membership_id}>
                  <td>
                    <div className="admin-employee-cell">
                      <div className="admin-avatar">
                        {row.employee ? employeeInitials(row.employee) : "?"}
                      </div>
                      <div className="admin-cell-main">
                        <strong>{row.employee?.full_name ?? row.membership_id.slice(0, 8)}</strong>
                      </div>
                    </div>
                  </td>
                  <td>{row.employee ? formatRoleLabel(row.employee.role) : row.role}</td>
                  <td><span className={workloadBadgeClass(row.open_conversations)}>{row.open_conversations}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card admin-table-card assignments-table-card">
        <div className="admin-table-header assignments-table-title">
          <div>
            <h2>فرق التوزيع</h2>
            <small>{visibleTeams.length} فريق</small>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table assignments-erp-table">
            <thead>
              <tr>
                <th className="th-brand">الفريق</th>
                <th>الفرع</th>
                <th className="th-brand">الأعضاء</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visibleTeams.length === 0 && (
                <tr><td colSpan={4} className="admin-table-empty">لا توجد فرق. أنشئ فريقاً من النموذج أعلاه.</td></tr>
              )}
              {visibleTeams.map((team) => (
                <tr key={team.id}>
                  <td><strong>{team.name}</strong></td>
                  <td>{orgMap.get(team.organization_id) ?? "—"}</td>
                  <td>{renderMemberChips(team.membership_ids)}</td>
                  <td>
                    <div className="admin-actions">
                      <button type="button" className="secondary-button assignments-action-btn" onClick={() => openTeamEditor(team)}>تعديل</button>
                      <button type="button" className="secondary-button assignments-action-btn assignments-action-danger" onClick={() => void deleteTeamItem(team)}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card admin-table-card assignments-table-card">
        <div className="admin-table-header assignments-table-title">
          <div>
            <h2>قواعد التوزيع</h2>
            <small>{visibleRules.filter((r) => r.is_active).length} نشطة من {visibleRules.length}</small>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table assignments-erp-table">
            <thead>
              <tr>
                <th className="th-brand">الاسم</th>
                <th className="th-brand">الفريق</th>
                <th>القناة</th>
                <th className="th-brand">الاستراتيجية</th>
                <th>الأولوية</th>
                <th className="th-brand">الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visibleRules.length === 0 && (
                <tr><td colSpan={7} className="admin-table-empty">لا توجد قواعد.</td></tr>
              )}
              {visibleRules.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td>{teamMap.get(item.team_id) ?? "—"}</td>
                  <td>{item.channel_id ? (channelMap.get(item.channel_id) ?? item.channel_id.slice(0, 8)) : "كل القنوات"}</td>
                  <td><span className="admin-chip admin-chip-whatsapp">{formatStrategy(item.strategy)}</span></td>
                  <td><span className="assignments-priority-badge">{item.priority}</span></td>
                  <td>
                    <span className={item.is_active ? "admin-status admin-status-active" : "admin-status admin-status-offline"}>
                      {item.is_active ? "نشطة" : "متوقفة"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <button type="button" className="secondary-button assignments-action-btn" onClick={() => void toggleRule(item)}>
                        {item.is_active ? "إيقاف" : "تفعيل"}
                      </button>
                      <button type="button" className="secondary-button assignments-action-btn assignments-action-danger" onClick={() => void deleteRuleItem(item)}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingTeam && (
        <div className="modal-overlay" onClick={() => setEditingTeam(null)}>
          <div className="modal-card assignments-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>تعديل فريق {editingTeam.name}</h2>
                <small>{orgMap.get(editingTeam.organization_id)}</small>
              </div>
              <button type="button" className="secondary-button" onClick={() => setEditingTeam(null)}>إغلاق</button>
            </header>
            <div className="admin-permissions-list">
              {employeesForBranch(employees.data ?? [], editingTeam.organization_id).map((item) => (
                <label key={item.membership_id} className="admin-permission-item">
                  <input
                    type="checkbox"
                    checked={editMembers.includes(item.membership_id)}
                    onChange={(e) =>
                      setEditMembers((current) =>
                        e.target.checked
                          ? [...current, item.membership_id]
                          : current.filter((id) => id !== item.membership_id)
                      )
                    }
                  />
                  <span>{item.full_name}</span>
                </label>
              ))}
            </div>
            <div className="admin-actions" style={{ marginTop: 16 }}>
              <button type="button" className="assignments-primary-btn" disabled={savingTeam || editMembers.length === 0} onClick={() => void saveTeamMembers()}>
                {savingTeam ? "جاري الحفظ…" : "حفظ الأعضاء"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
