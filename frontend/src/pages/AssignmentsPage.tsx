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
  STRATEGY_HINTS,
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
  const [ruleName, setRuleName] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingRule, setCreatingRule] = useState(false);
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
  const filteredBranchEmployees = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return branchEmployees;
    return branchEmployees.filter(
      (item) =>
        item.full_name.toLowerCase().includes(query) ||
        formatRoleLabel(item.role).includes(query)
    );
  }, [branchEmployees, memberSearch]);
  const ruleTeams = useMemo(() => {
    const all = teams.data ?? [];
    if (branchFilter) return teamsForBranch(all, branchFilter);
    return all;
  }, [teams.data, branchFilter]);
  const selectedTeam = useMemo(
    () => (teams.data ?? []).find((item) => item.id === teamId) ?? null,
    [teams.data, teamId]
  );
  const ruleTeamOrgId = selectedTeam?.organization_id ?? "";
  const setupReady = useMemo(() => {
    const activeRules = (rules.data ?? []).filter((item) => item.is_active).length;
    const teamCount = (teams.data ?? []).length;
    return teamCount > 0 && activeRules > 0;
  }, [rules.data, teams.data]);
  const duplicateRule = useMemo(() => {
    if (!teamId) return false;
    return (rules.data ?? []).some(
      (item) =>
        item.is_active &&
        item.team_id === teamId &&
        (item.channel_id ?? "") === (channelId || "")
    );
  }, [rules.data, teamId, channelId]);

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
    if (selectedMembers.length === 0) return;
    setCreatingTeam(true);
    try {
      const response = await api.post<AssignmentTeam>("/assignments/teams", {
        organization_id: organizationId,
        name: teamName.trim(),
        description: null,
        membership_ids: selectedMembers
      });
      setTeamName("");
      setSelectedMembers([]);
      setMemberSearch("");
      setTeamId(response.data.id);
      setOrganizationId(response.data.organization_id);
      await client.invalidateQueries({ queryKey: ["assignment-teams"] });
      toastStore.getState().show("تم إنشاء الفريق. أكمل الخطوة 2 لتفعيل التوزيع التلقائي.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء الفريق. تأكد أن الأعضاء من نفس الفرع.", "error");
    } finally {
      setCreatingTeam(false);
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    const team = selectedTeam;
    if (!team || team.membership_ids.length === 0) {
      toastStore.getState().show("اختر فريقاً يحتوي على موظف واحد على الأقل.", "error");
      return;
    }
    if (duplicateRule) {
      toastStore.getState().show("توجد قاعدة نشطة مماثلة لهذا الفريق والقناة.", "error");
      return;
    }
    setCreatingRule(true);
    try {
      await api.post("/assignments/rules", {
        organization_id: team.organization_id,
        channel_id: channelId || null,
        team_id: teamId,
        name: ruleName.trim() || `توزيع ${team.name}`,
        strategy,
        priority: rulePriority,
        is_active: true
      });
      setRuleName("");
      setChannelId("");
      await client.invalidateQueries({ queryKey: ["assignment-rules"] });
      toastStore.getState().show("تم تفعيل قاعدة التوزيع — المحادثات الجديدة ستُوزَّع تلقائياً.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ القاعدة.", "error");
    } finally {
      setCreatingRule(false);
    }
  }

  function selectAllMembers() {
    setSelectedMembers(filteredBranchEmployees.map((item) => item.membership_id));
  }

  function clearMembers() {
    setSelectedMembers([]);
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
          <select
            value={branchFilter}
            onChange={(e) => {
              const value = e.target.value;
              setBranchFilter(value);
              if (value) setOrganizationId(value);
            }}
          >
            <option value="">كل الأفرع</option>
            {(organizations.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
      </section>

      <section className={`assignments-setup-banner ${setupReady ? "ready" : "pending"}`}>
        <div>
          <strong>{setupReady ? "التوزيع التلقائي يعمل" : "لتشغيل التوزيع بانتظام"}</strong>
          <small>
            {setupReady
              ? "يوجد فريق وقاعدة نشطة — المحادثات الجديدة تُوزَّع تلقائياً."
              : "① أنشئ فريقاً بموظفي الفرع → ② فعّل قاعدة توزيع نشطة."}
          </small>
        </div>
        <span className="assignments-setup-status">{setupReady ? "جاهز" : "يتطلب إعداد"}</span>
      </section>

      <section className="assignments-forms-grid">
        <article className="card form-card admin-form-card assignments-form-card">
          <div className="assignments-form-head">
            <div>
              <h2>إنشاء فريق توزيع</h2>
              <small>الخطوة 1 — تحديد من يستقبل المحادثات</small>
            </div>
            <span className="assignments-form-step">1</span>
          </div>
          <form className="assignments-setup-form" onSubmit={createTeam}>
            <div className="assignments-field-grid">
              <label className="assignments-field">
                <span>الفرع</span>
                <select
                  value={organizationId}
                  onChange={(e) => {
                    setOrganizationId(e.target.value);
                    setSelectedMembers([]);
                    setMemberSearch("");
                  }}
                  required
                >
                  <option value="">اختر الفرع</option>
                  {(organizations.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className="assignments-field">
                <span>اسم الفريق</span>
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="مثال: فريق المبيعات"
                  required
                />
              </label>
            </div>

            <div className="assignments-members-box">
              <div className="assignments-members-toolbar">
                <label className="assignments-field assignments-field-grow">
                  <span>أعضاء الفريق ({selectedMembers.length} محدد)</span>
                  <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الدور…"
                    disabled={!organizationId}
                  />
                </label>
                <div className="assignments-members-actions">
                  <button type="button" className="secondary-button" onClick={selectAllMembers} disabled={!organizationId || filteredBranchEmployees.length === 0}>
                    تحديد الكل
                  </button>
                  <button type="button" className="secondary-button" onClick={clearMembers} disabled={selectedMembers.length === 0}>
                    إلغاء
                  </button>
                </div>
              </div>
              <div className="assignments-member-picker">
                {!organizationId && <small className="hint-text">اختر الفرع أولاً لعرض الموظفين.</small>}
                {organizationId && filteredBranchEmployees.length === 0 && (
                  <small className="hint-text">لا يوجد موظفون نشطون في هذا الفرع.</small>
                )}
                {filteredBranchEmployees.map((item) => (
                  <label key={item.membership_id} className="assignments-member-row">
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
                    <span className="assignments-member-name">{item.full_name}</span>
                    <span className="assignments-member-role">{formatRoleLabel(item.role)}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              className="assignments-primary-btn assignments-form-submit"
              type="submit"
              disabled={creatingTeam || !organizationId || !teamName.trim() || selectedMembers.length === 0}
            >
              {creatingTeam ? "جاري الإنشاء…" : "إنشاء الفريق"}
            </button>
          </form>
        </article>

        <article className={`card form-card admin-form-card assignments-form-card ${ruleTeams.length === 0 ? "assignments-form-disabled" : ""}`}>
          <div className="assignments-form-head">
            <div>
              <h2>قاعدة توزيع تلقائي</h2>
              <small>الخطوة 2 — تفعيل التوزيع على المحادثات الجديدة</small>
            </div>
            <span className="assignments-form-step">2</span>
          </div>
          {ruleTeams.length === 0 ? (
            <p className="hint-text assignments-form-blocked">أنشئ فريقاً في الخطوة 1 أولاً.</p>
          ) : (
            <form className="assignments-setup-form" onSubmit={createRule}>
              <div className="assignments-field-grid">
                <label className="assignments-field">
                  <span>فريق التوزيع</span>
                  <select
                    value={teamId}
                    onChange={(e) => {
                      setTeamId(e.target.value);
                      setChannelId("");
                    }}
                    required
                  >
                    <option value="">اختر الفريق</option>
                    {ruleTeams.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {orgMap.get(item.organization_id)} · {item.membership_ids.length} عضو
                      </option>
                    ))}
                  </select>
                </label>
                <label className="assignments-field">
                  <span>قناة WhatsApp</span>
                  <select value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!teamId}>
                    <option value="">كل قنوات الفرع</option>
                    {channelsForBranch(channels.data ?? [], ruleTeamOrgId).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="assignments-field">
                <span>اسم القاعدة (اختياري)</span>
                <input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder={selectedTeam ? `توزيع ${selectedTeam.name}` : "اسم القاعدة"}
                  disabled={!teamId}
                />
              </label>

              <div className="assignments-strategy-grid">
                {(["round_robin", "least_open"] as AssignmentStrategy[]).map((item) => (
                  <label key={item} className={`assignments-strategy-card ${strategy === item ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="strategy"
                      value={item}
                      checked={strategy === item}
                      onChange={() => setStrategy(item)}
                      disabled={!teamId}
                    />
                    <strong>{formatStrategy(item)}</strong>
                    <small>{STRATEGY_HINTS[item]}</small>
                  </label>
                ))}
              </div>

              <label className="assignments-field assignments-field-inline">
                <span>الأولوية</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={rulePriority}
                  onChange={(e) => setRulePriority(Number(e.target.value))}
                  disabled={!teamId}
                />
                <small className="hint-text">رقم أقل = يُطبَّق أولاً عند وجود أكثر من قاعدة</small>
              </label>

              {duplicateRule && (
                <p className="assignments-form-warning">توجد قاعدة نشطة مماثلة — أوقفها أو غيّر القناة قبل الحفظ.</p>
              )}
              {selectedTeam && selectedTeam.membership_ids.length === 0 && (
                <p className="assignments-form-warning">الفريق المختار بلا أعضاء — أضف موظفين من جدول الفرق.</p>
              )}

              <button
                className="assignments-primary-btn assignments-form-submit"
                type="submit"
                disabled={
                  creatingRule ||
                  !teamId ||
                  duplicateRule ||
                  !selectedTeam ||
                  selectedTeam.membership_ids.length === 0
                }
              >
                {creatingRule ? "جاري التفعيل…" : "تفعيل قاعدة التوزيع"}
              </button>
            </form>
          )}
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
                <th>الموظف</th>
                <th>الدور</th>
                <th>محادثات مفتوحة</th>
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
                <th>الفريق</th>
                <th>الفرع</th>
                <th>الأعضاء</th>
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
                <th>الاسم</th>
                <th>الفريق</th>
                <th>القناة</th>
                <th>الاستراتيجية</th>
                <th>الأولوية</th>
                <th>الحالة</th>
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
