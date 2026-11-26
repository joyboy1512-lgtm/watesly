import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  DEAL_STAGES,
  LOSS_REASON_LABELS,
  LOSS_REASONS,
  STAGE_COLORS,
  STAGE_LABELS,
  bulkUpdateDealStage,
  downloadDealsExport,
  formatDealAmount,
  type CrmQuickFilter,
  type CrmStats,
  type Deal,
  type DealActivity,
  type DealStage,
  type FollowUpCounts,
  type LossReason
} from "../lib/crmHelpers";
import { contactDisplayLabel, type Organization } from "../lib/contactHelpers";
import Icon from "../components/Icon";
import { toastStore } from "../stores/toast";
import { useHasPermission } from "../hooks/usePermissions";

type ViewMode = "kanban" | "list";

export default function CrmPage() {
  const { t } = useTranslation();
  const canViewUsers = useHasPermission("users.view");
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stageFilter, setStageFilter] = useState(searchParams.get("stage") ?? "");
  const [orgFilter, setOrgFilter] = useState(searchParams.get("organization_id") ?? "");
  const [assigneeFilter, setAssigneeFilter] = useState(searchParams.get("assigned_membership_id") ?? "");
  const [quickFilter, setQuickFilter] = useState<CrmQuickFilter>(
    (searchParams.get("quick") as CrmQuickFilter) || ""
  );
  const [lossReasonFilter, setLossReasonFilter] = useState(searchParams.get("loss_reason") ?? "");
  const [sourceFilter, setSourceFilter] = useState(searchParams.get("source") ?? "");
  const [updatedSince, setUpdatedSince] = useState(searchParams.get("updated_since") ?? "");
  const [idsFilter, setIdsFilter] = useState(searchParams.get("ids") ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<DealStage>("qualified");
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(searchParams.get("deal") || null);
  const [lossModal, setLossModal] = useState<{ dealId: string; pendingStage: DealStage } | null>(null);
  const [lossReason, setLossReason] = useState<LossReason>("no_reply");
  const [lossDetail, setLossDetail] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (stageFilter) params.set("stage", stageFilter);
    if (orgFilter) params.set("organization_id", orgFilter);
    if (assigneeFilter) params.set("assigned_membership_id", assigneeFilter);
    if (quickFilter) params.set("quick", quickFilter);
    if (lossReasonFilter) params.set("loss_reason", lossReasonFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    if (updatedSince) params.set("updated_since", updatedSince);
    if (idsFilter) params.set("ids", idsFilter);
    if (selectedDealId) params.set("deal", selectedDealId);
    setSearchParams(params, { replace: true });
  }, [
    stageFilter,
    orgFilter,
    assigneeFilter,
    quickFilter,
    lossReasonFilter,
    sourceFilter,
    updatedSince,
    idsFilter,
    selectedDealId,
    setSearchParams
  ]);

  const stats = useQuery({
    queryKey: ["crm-stats"],
    queryFn: async () => (await api.get<CrmStats>("/platform/crm/stats")).data
  });

  const followUp = useQuery({
    queryKey: ["crm-follow-up", orgFilter],
    queryFn: async () =>
      (
        await api.get<FollowUpCounts>("/platform/crm/follow-up-counts", {
          params: orgFilter ? { organization_id: orgFilter } : undefined
        })
      ).data,
    refetchInterval: 60_000
  });

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const employees = useQuery({
    queryKey: ["employees"],
    enabled: canViewUsers,
    queryFn: async () => (await api.get<{ membership_id: string; full_name: string }[]>("/team/employees")).data
  });

  const effectiveQuick =
    lossReasonFilter ? `loss:${lossReasonFilter}` : quickFilter || undefined;

  const deals = useQuery({
    queryKey: [
      "deals",
      debouncedSearch,
      stageFilter,
      orgFilter,
      assigneeFilter,
      effectiveQuick,
      sourceFilter,
      updatedSince,
      idsFilter
    ],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.q = debouncedSearch;
      if (stageFilter) params.stage = stageFilter;
      if (orgFilter) params.organization_id = orgFilter;
      if (assigneeFilter) params.assigned_membership_id = assigneeFilter;
      if (effectiveQuick) params.quick_filter = effectiveQuick;
      if (sourceFilter) {
        // API accepts a single source; when comma-separated, fetch without source and filter client-side.
        if (!sourceFilter.includes(",")) params.source = sourceFilter;
      }
      if (updatedSince) params.updated_since = `${updatedSince}T00:00:00Z`;
      if (idsFilter) params.ids = idsFilter;
      let rows = (await api.get<Deal[]>("/platform/crm/deals", { params })).data;
      if (sourceFilter.includes(",")) {
        const allowed = new Set(sourceFilter.split(",").map((s) => s.trim()).filter(Boolean));
        rows = rows.filter((d) => d.source && allowed.has(d.source));
      }
      return rows;
    }
  });

  const dealDetail = useQuery({
    queryKey: ["deal", selectedDealId],
    enabled: Boolean(selectedDealId),
    queryFn: async () => (await api.get<Deal>(`/platform/crm/deals/${selectedDealId}`)).data
  });

  const activities = useQuery({
    queryKey: ["deal-activities", selectedDealId],
    enabled: Boolean(selectedDealId),
    queryFn: async () =>
      (await api.get<DealActivity[]>(`/platform/crm/deals/${selectedDealId}/activities`)).data
  });

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations.data ?? []) map.set(org.id, org.name);
    return map;
  }, [organizations.data]);

  const rows = deals.data ?? [];
  const selectedCount = selectedIds.size;
  const maxFunnel = Math.max(...DEAL_STAGES.map((s) => stats.data?.by_stage?.[s] ?? 0), 1);
  const lossBreakdown = followUp.data?.loss_reasons ?? stats.data?.loss_reasons ?? {};
  const lostTotal = followUp.data?.lost_total ?? stats.data?.lost_total ?? stats.data?.by_stage?.lost ?? 0;
  const lossSum = Object.values(lossBreakdown).reduce((sum, n) => sum + n, 0);

  async function applyStageChange(dealId: string, stage: DealStage, extra?: { loss_reason?: string; loss_reason_detail?: string }) {
    try {
      await api.patch(`/platform/crm/deals/${dealId}/stage`, { stage, ...extra });
      await client.invalidateQueries({ queryKey: ["deals"] });
      await client.invalidateQueries({ queryKey: ["crm-stats"] });
      await client.invalidateQueries({ queryKey: ["crm-follow-up"] });
      await client.invalidateQueries({ queryKey: ["deal", dealId] });
      await client.invalidateQueries({ queryKey: ["deal-activities", dealId] });
    } catch {
      toastStore.getState().show("تعذر تحديث المرحلة.", "error");
    }
  }

  async function moveStage(dealId: string, stage: DealStage) {
    if (stage === "lost") {
      setLossReason("no_reply");
      setLossDetail("");
      setLossModal({ dealId, pendingStage: stage });
      return;
    }
    await applyStageChange(dealId, stage);
  }

  async function confirmLoss(event: FormEvent) {
    event.preventDefault();
    if (!lossModal) return;
    await applyStageChange(lossModal.dealId, "lost", {
      loss_reason: lossReason,
      loss_reason_detail: lossReason === "other" ? lossDetail.trim() || undefined : undefined
    });
    setLossModal(null);
  }

  async function handleExport(all = true) {
    try {
      await downloadDealsExport(all ? undefined : [...selectedIds]);
    } catch {
      toastStore.getState().show("تعذر تحميل الملف.", "error");
    }
  }

  async function applyBulkStage() {
    if (!selectedIds.size) return;
    try {
      if (bulkStage === "lost") {
        setLossModal({ dealId: [...selectedIds][0], pendingStage: "lost" });
        return;
      }
      const result = await bulkUpdateDealStage([...selectedIds], bulkStage);
      toastStore.getState().show(`تم تحديث ${result.updated} صفقة.`, "success");
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["deals"] });
      await client.invalidateQueries({ queryKey: ["crm-stats"] });
      await client.invalidateQueries({ queryKey: ["crm-follow-up"] });
    } catch {
      toastStore.getState().show("تعذر التحديث الجماعي.", "error");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDrop(stage: DealStage, dealId: string) {
    setDragOverStage(null);
    if (!dealId) return;
    void moveStage(dealId, stage);
  }

  function toggleQuick(next: CrmQuickFilter) {
    setQuickFilter((current) => (current === next ? "" : next));
    setLossReasonFilter("");
    if (next) setStageFilter("");
  }

  function openLostStage() {
    setStageFilter("lost");
    setQuickFilter("");
    setLossReasonFilter("");
  }

  return (
    <main className="page crm-page">
      <section className="crm-erp-shell">
        <header className="crm-erp-header">
          <div>
            <span className="crm-erp-eyebrow">CRM</span>
            <h1>{t("pages.crm")}</h1>
            <p>متابعة الصفقات اليومية: ماذا يحتاج عملاً اليوم، وماذا تأخر، ولماذا خسرنا.</p>
          </div>
          <Link to="/reports?tab=crm" className="crm-erp-btn">تقارير CRM</Link>
        </header>

        <section className="admin-stats-row admin-stats-row-brand">
          <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي الصفقات</span><strong>{stats.data?.total ?? "…"}</strong></article>
          <article className="admin-stat-card admin-stat-card-brand"><span>مفتوحة</span><strong>{stats.data?.open ?? "…"}</strong></article>
          <article className="admin-stat-card admin-stat-card-brand"><span>فوز (30 يوم)</span><strong>{stats.data?.won_month ?? "…"}</strong></article>
          <article className="admin-stat-card admin-stat-card-brand"><span>قيمة Pipeline</span><strong>{stats.data?.pipeline_value?.toLocaleString("ar") ?? "…"}</strong></article>
        </section>

        <div className="crm-quick-filters" role="group" aria-label="فلاتر المتابعة">
          <button
            type="button"
            className={`crm-quick-chip ${quickFilter === "my_today" ? "active" : ""}`}
            onClick={() => toggleQuick("my_today")}
          >
            متابعتي اليوم <strong>{followUp.data?.my_today ?? "…"}</strong>
          </button>
          <button
            type="button"
            className={`crm-quick-chip ${quickFilter === "overdue" ? "active" : ""}`}
            onClick={() => toggleQuick("overdue")}
          >
            متأخرة <strong>{followUp.data?.overdue ?? "…"}</strong>
          </button>
          <button
            type="button"
            className={`crm-quick-chip ${quickFilter === "unassigned" ? "active" : ""}`}
            onClick={() => toggleQuick("unassigned")}
          >
            دون مسؤول <strong>{followUp.data?.unassigned ?? "…"}</strong>
          </button>
        </div>

        <div className="crm-funnel">
          {DEAL_STAGES.map((stage) => {
            const count = stats.data?.by_stage?.[stage] ?? 0;
            return (
              <button
                key={stage}
                type="button"
                className={`crm-funnel-step ${stageFilter === stage ? "active" : ""}`}
                onClick={() => {
                  setQuickFilter("");
                  setLossReasonFilter("");
                  setStageFilter((current) => (current === stage ? "" : stage));
                }}
              >
                <span>{STAGE_LABELS[stage]}</span>
                <strong>{count}</strong>
                <i style={{ width: `${Math.max(8, (count / maxFunnel) * 100)}%` }} />
              </button>
            );
          })}
        </div>

        {(stageFilter === "lost" || lossReasonFilter) && (
          <section className="crm-loss-breakdown card">
            <div className="crm-loss-head">
              <h2 className="section-title-sm">توزيع أسباب الخسارة</h2>
              <p className="hint-text">
                القائمة: {rows.length.toLocaleString("ar")} · الإجمالي: {lostTotal.toLocaleString("ar")}
                {lossSum !== lostTotal ? ` · توزيع الأسباب: ${lossSum.toLocaleString("ar")}` : ""}
              </p>
              <button type="button" className="crm-erp-btn" onClick={openLostStage}>كل الخسائر</button>
            </div>
            <div className="crm-loss-chips">
              {LOSS_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className={`crm-quick-chip ${lossReasonFilter === reason ? "active" : ""}`}
                  onClick={() => {
                    setStageFilter("lost");
                    setQuickFilter("");
                    setLossReasonFilter((current) => (current === reason ? "" : reason));
                  }}
                >
                  {LOSS_REASON_LABELS[reason]} <strong>{lossBreakdown[reason] ?? 0}</strong>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="crm-erp-toolbar">
          <div className="crm-erp-actions">
            <Link to="/crm/new" className="crm-erp-btn crm-erp-btn-primary">
              <Icon name="plus" /> صفقة جديدة
            </Link>
            <button type="button" className="crm-erp-btn" onClick={() => void handleExport(true)}>تحميل Excel</button>
            {selectedCount > 0 && (
              <>
                <span className="contacts-selection-badge">{selectedCount} محدّد</span>
                <button type="button" className="crm-erp-btn" onClick={() => void handleExport(false)}>تحميل المحدّد</button>
                <select value={bulkStage} onChange={(e) => setBulkStage(e.target.value as DealStage)}>
                  {DEAL_STAGES.map((stage) => (
                    <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
                  ))}
                </select>
                <button type="button" className="crm-erp-btn" onClick={() => void applyBulkStage()}>نقل المرحلة</button>
                <button type="button" className="crm-erp-btn" onClick={() => setSelectedIds(new Set())}>إلغاء</button>
              </>
            )}
            <button type="button" className={viewMode === "kanban" ? "crm-erp-btn active" : "crm-erp-btn"} onClick={() => setViewMode("kanban")}>Kanban</button>
            <button type="button" className={viewMode === "list" ? "crm-erp-btn active" : "crm-erp-btn"} onClick={() => setViewMode("list")}>قائمة</button>
          </div>
          <div className="crm-erp-filters">
            <input className="crm-erp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث…" />
            <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
              <option value="">كل الأفرع</option>
              {(organizations.data ?? []).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="">كل المسؤولين</option>
              {(employees.data ?? []).map((item) => (
                <option key={item.membership_id} value={item.membership_id}>{item.full_name}</option>
              ))}
            </select>
          </div>
        </div>

        {deals.isLoading && <p className="hint-text">جاري التحميل…</p>}

        {!deals.isLoading && rows.length === 0 && (
          <div className="crm-empty">
            <p>لا توجد صفقات مطابقة للفلاتر الحالية.</p>
            <Link to="/crm/new" className="crm-erp-btn crm-erp-btn-primary">صفقة جديدة</Link>
          </div>
        )}

        <div className={`crm-board-layout ${selectedDealId ? "with-panel" : ""}`}>
          <div className="crm-board-main">
            {viewMode === "kanban" && rows.length > 0 && (
              <section className="pipeline-board crm-pipeline">
                {DEAL_STAGES.map((stage) => (
                  <div
                    key={stage}
                    className={`pipeline-column ${dragOverStage === stage ? "crm-drop-target" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage); }}
                    onDragLeave={() => setDragOverStage(null)}
                    onDrop={(e) => handleDrop(stage, e.dataTransfer.getData("dealId"))}
                  >
                    <div className="pipeline-column-head">
                      <h3>{STAGE_LABELS[stage]}</h3>
                      <span className={`crm-stage-pill ${STAGE_COLORS[stage]}`}>
                        {rows.filter((d) => d.stage === stage).length}
                      </span>
                    </div>
                    {rows.filter((d) => d.stage === stage).map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        orgMap={orgMap}
                        selected={selectedIds.has(deal.id)}
                        active={selectedDealId === deal.id}
                        onToggleSelect={toggleSelect}
                        onMoveStage={moveStage}
                        onOpen={() => setSelectedDealId(deal.id)}
                      />
                    ))}
                  </div>
                ))}
              </section>
            )}

            {viewMode === "list" && rows.length > 0 && (
              <div className="table-card">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" checked={selectedIds.size === rows.length && rows.length > 0} onChange={(e) => setSelectedIds(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                      <th>العميل</th>
                      <th>الصفقة</th>
                      <th>المرحلة</th>
                      <th>المبلغ</th>
                      <th>المسؤول</th>
                      <th>الخطوة التالية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((deal) => (
                      <tr
                        key={deal.id}
                        className={`${selectedIds.has(deal.id) ? "crm-row-selected" : ""} ${selectedDealId === deal.id ? "crm-row-active" : ""}`}
                        onClick={() => setSelectedDealId(deal.id)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(deal.id)} onChange={() => toggleSelect(deal.id)} />
                        </td>
                        <td>
                          {deal.contact_id ? (
                            <Link to={`/contacts/${deal.contact_id}`} onClick={(e) => e.stopPropagation()}>
                              {contactDisplayLabel({ display_name: deal.contact_name, external_address: deal.contact_phone ?? "" })}
                            </Link>
                          ) : "—"}
                        </td>
                        <td>{deal.title}</td>
                        <td><span className={`crm-stage-pill ${STAGE_COLORS[deal.stage]}`}>{STAGE_LABELS[deal.stage]}</span></td>
                        <td>{formatDealAmount(deal)}</td>
                        <td>{deal.assignee_name ?? "—"}</td>
                        <td>
                          {deal.next_step || "—"}
                          {deal.next_step_at ? (
                            <small className="hint-text"> · {new Date(deal.next_step_at).toLocaleString("ar")}</small>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedDealId && (
            <aside className="crm-side-panel card">
              <header className="crm-side-panel-head">
                <div>
                  <h2>{dealDetail.data?.title ?? "…"}</h2>
                  {dealDetail.data && (
                    <span className={`crm-stage-pill ${STAGE_COLORS[dealDetail.data.stage]}`}>
                      {STAGE_LABELS[dealDetail.data.stage]}
                    </span>
                  )}
                </div>
                <button type="button" className="crm-erp-btn" onClick={() => setSelectedDealId(null)}>إغلاق</button>
              </header>
              {dealDetail.isLoading && <p className="hint-text">جاري التحميل…</p>}
              {dealDetail.data && (
                <>
                  <dl className="crm-detail-list">
                    <div>
                      <dt>العميل</dt>
                      <dd>
                        {dealDetail.data.contact_id ? (
                          <Link to={`/contacts/${dealDetail.data.contact_id}`}>
                            {contactDisplayLabel({
                              display_name: dealDetail.data.contact_name,
                              external_address: dealDetail.data.contact_phone ?? ""
                            })}
                          </Link>
                        ) : "—"}
                      </dd>
                    </div>
                    <div><dt>القيمة</dt><dd>{formatDealAmount(dealDetail.data)}</dd></div>
                    <div><dt>المسؤول</dt><dd>{dealDetail.data.assignee_name ?? "—"}</dd></div>
                    <div><dt>القناة / المصدر</dt><dd>{dealDetail.data.source ?? "—"}</dd></div>
                    <div><dt>الفرع</dt><dd>{dealDetail.data.organization_name ?? orgMap.get(dealDetail.data.organization_id ?? "") ?? "—"}</dd></div>
                    <div>
                      <dt>الخطوة التالية</dt>
                      <dd>
                        {dealDetail.data.next_step || "—"}
                        {dealDetail.data.next_step_at
                          ? ` · ${new Date(dealDetail.data.next_step_at).toLocaleString("ar")}`
                          : ""}
                      </dd>
                    </div>
                    {dealDetail.data.stage === "lost" && (
                      <div>
                        <dt>سبب الخسارة</dt>
                        <dd>
                          {LOSS_REASON_LABELS[(dealDetail.data.loss_reason as LossReason) || "unspecified"]
                            ?? dealDetail.data.loss_reason
                            ?? "غير محدد"}
                          {dealDetail.data.loss_reason_detail ? ` — ${dealDetail.data.loss_reason_detail}` : ""}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <div className="inline-actions">
                    {dealDetail.data.conversation_id ? (
                      <Link
                        className="whatsapp-button"
                        to={`/inbox?conversation=${dealDetail.data.conversation_id}`}
                        state={{ returnTo: `/crm?${searchParams.toString()}` }}
                      >
                        المحادثة الأصلية
                      </Link>
                    ) : dealDetail.data.contact_id ? (
                      <Link className="secondary-button" to={`/contacts/${dealDetail.data.contact_id}`}>
                        فتح جهة الاتصال
                      </Link>
                    ) : null}
                    <Link className="secondary-button" to={`/crm/${dealDetail.data.id}`}>التفاصيل الكاملة</Link>
                  </div>
                  <h3 className="section-title-sm">سجل المراحل</h3>
                  <ul className="crm-stage-history">
                    {(dealDetail.data.stage_history ?? activities.data ?? []).map((item) => (
                      <li key={item.id}>
                        <strong>{item.activity_type}</strong>
                        <span>{item.body}</span>
                        <small>{item.created_at ? new Date(item.created_at).toLocaleString("ar") : ""}</small>
                      </li>
                    ))}
                    {(dealDetail.data.stage_history ?? activities.data ?? []).length === 0 && (
                      <li className="hint-text">لا يوجد سجل بعد.</li>
                    )}
                  </ul>
                </>
              )}
            </aside>
          )}
        </div>
      </section>

      {lossModal && (
        <div className="crm-modal-backdrop" role="dialog" aria-modal="true">
          <form className="crm-modal card" onSubmit={(e) => void confirmLoss(e)}>
            <h3>سبب الخسارة</h3>
            <p className="hint-text">سجّل السبب حتى يظهر في توزيع الخسائر.</p>
            <label className="field-label">
              <span>السبب</span>
              <select value={lossReason} onChange={(e) => setLossReason(e.target.value as LossReason)}>
                {LOSS_REASONS.filter((r) => r !== "unspecified").map((reason) => (
                  <option key={reason} value={reason}>{LOSS_REASON_LABELS[reason]}</option>
                ))}
              </select>
            </label>
            {lossReason === "other" && (
              <label className="field-label">
                <span>تفاصيل مخصصة</span>
                <input value={lossDetail} onChange={(e) => setLossDetail(e.target.value)} required />
              </label>
            )}
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={() => setLossModal(null)}>إلغاء</button>
              <button type="submit" className="whatsapp-button">تأكيد الخسارة</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function DealCard({
  deal,
  orgMap,
  selected,
  active,
  onToggleSelect,
  onMoveStage,
  onOpen
}: {
  deal: Deal;
  orgMap: Map<string, string>;
  selected: boolean;
  active: boolean;
  onToggleSelect: (id: string) => void;
  onMoveStage: (dealId: string, stage: DealStage) => void;
  onOpen: () => void;
}) {
  return (
    <article
      className={`pipeline-card crm-deal-card ${selected ? "crm-deal-selected" : ""} ${active ? "crm-deal-active" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("dealId", deal.id)}
      onClick={onOpen}
    >
      <label className="crm-deal-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(deal.id)} />
      </label>
      <strong className="crm-deal-contact-name">
        {deal.contact_id
          ? contactDisplayLabel({ display_name: deal.contact_name, external_address: deal.contact_phone ?? "" })
          : deal.title}
      </strong>
      <p className="crm-deal-amount">{formatDealAmount(deal)}</p>
      <small className="hint-text">المسؤول: {deal.assignee_name ?? "دون مسؤول"}</small>
      <small className="crm-next-step">
        الخطوة: {deal.next_step || "—"}
        {deal.next_step_at ? ` · ${new Date(deal.next_step_at).toLocaleDateString("ar")}` : ""}
      </small>
      {deal.organization_id && <small className="hint-text">{orgMap.get(deal.organization_id)}</small>}
      {deal.source === "inbound" && <span className="crm-source-badge">WhatsApp</span>}
      <select
        value={deal.stage}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => void onMoveStage(deal.id, e.target.value as DealStage)}
      >
        {DEAL_STAGES.map((stage) => (
          <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
        ))}
      </select>
    </article>
  );
}
