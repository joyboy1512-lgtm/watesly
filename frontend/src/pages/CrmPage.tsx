import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  DEAL_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  bulkUpdateDealStage,
  downloadDealsExport,
  formatDealAmount,
  type CrmStats,
  type Deal,
  type DealStage
} from "../lib/crmHelpers";
import { contactDisplayLabel, type Organization } from "../lib/contactHelpers";
import Icon from "../components/Icon";
import { toastStore } from "../stores/toast";

type ViewMode = "kanban" | "list";

export default function CrmPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stageFilter, setStageFilter] = useState(searchParams.get("stage") ?? "");
  const [orgFilter, setOrgFilter] = useState(searchParams.get("organization_id") ?? "");
  const [assigneeFilter, setAssigneeFilter] = useState(searchParams.get("assigned_membership_id") ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<DealStage>("qualified");
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (stageFilter) params.set("stage", stageFilter);
    if (orgFilter) params.set("organization_id", orgFilter);
    if (assigneeFilter) params.set("assigned_membership_id", assigneeFilter);
    setSearchParams(params, { replace: true });
  }, [stageFilter, orgFilter, assigneeFilter, setSearchParams]);

  const stats = useQuery({
    queryKey: ["crm-stats"],
    queryFn: async () => (await api.get<CrmStats>("/platform/crm/stats")).data
  });

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await api.get<{ membership_id: string; full_name: string }[]>("/team/employees")).data
  });

  const deals = useQuery({
    queryKey: ["deals", debouncedSearch, stageFilter, orgFilter, assigneeFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.q = debouncedSearch;
      if (stageFilter) params.stage = stageFilter;
      if (orgFilter) params.organization_id = orgFilter;
      if (assigneeFilter) params.assigned_membership_id = assigneeFilter;
      return (await api.get<Deal[]>("/platform/crm/deals", { params })).data;
    }
  });

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations.data ?? []) map.set(org.id, org.name);
    return map;
  }, [organizations.data]);

  const rows = deals.data ?? [];
  const selectedCount = selectedIds.size;
  const maxFunnel = Math.max(...DEAL_STAGES.map((s) => stats.data?.by_stage?.[s] ?? 0), 1);

  async function moveStage(dealId: string, stage: DealStage) {
    try {
      await api.patch(`/platform/crm/deals/${dealId}/stage`, { stage });
      await client.invalidateQueries({ queryKey: ["deals"] });
      await client.invalidateQueries({ queryKey: ["crm-stats"] });
    } catch {
      toastStore.getState().show("تعذر تحديث المرحلة.", "error");
    }
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
      const result = await bulkUpdateDealStage([...selectedIds], bulkStage);
      toastStore.getState().show(`تم تحديث ${result.updated} صفقة.`, "success");
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["deals"] });
      await client.invalidateQueries({ queryKey: ["crm-stats"] });
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

  return (
    <main className="page crm-page">
      <section className="crm-erp-shell">
        <header className="crm-erp-header">
          <div>
            <span className="crm-erp-eyebrow">CRM</span>
            <h1>{t("pages.crm")}</h1>
            <p>إدارة فرص البيع، المراحل، والربط مع العملاء.</p>
          </div>
          <Link to="/reports?tab=crm" className="crm-erp-btn">تقارير CRM</Link>
        </header>

        <div className="crm-stats-grid">
          <article className="metric-card"><span>إجمالي الصفقات</span><strong>{stats.data?.total ?? "…"}</strong></article>
          <article className="metric-card"><span>مفتوحة</span><strong>{stats.data?.open ?? "…"}</strong></article>
          <article className="metric-card"><span>فوز (30 يوم)</span><strong>{stats.data?.won_month ?? "…"}</strong></article>
          <article className="metric-card"><span>قيمة Pipeline</span><strong>{stats.data?.pipeline_value?.toLocaleString("ar") ?? "…"}</strong></article>
        </div>

        <div className="crm-funnel">
          {DEAL_STAGES.map((stage) => {
            const count = stats.data?.by_stage?.[stage] ?? 0;
            return (
              <button
                key={stage}
                type="button"
                className={`crm-funnel-step ${stageFilter === stage ? "active" : ""}`}
                onClick={() => setStageFilter((current) => (current === stage ? "" : stage))}
              >
                <span>{STAGE_LABELS[stage]}</span>
                <strong>{count}</strong>
                <i style={{ width: `${Math.max(8, (count / maxFunnel) * 100)}%` }} />
              </button>
            );
          })}
        </div>

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
            <p>لا توجد صفقات.</p>
            <Link to="/crm/new" className="crm-erp-btn crm-erp-btn-primary">صفقة جديدة</Link>
          </div>
        )}

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
                    onToggleSelect={toggleSelect}
                    onMoveStage={moveStage}
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
                  <th>الصفقة</th>
                  <th>العميل</th>
                  <th>المرحلة</th>
                  <th>المبلغ</th>
                  <th>الفرع</th>
                  <th>الاحتمال</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((deal) => (
                  <tr key={deal.id} className={selectedIds.has(deal.id) ? "crm-row-selected" : ""}>
                    <td><input type="checkbox" checked={selectedIds.has(deal.id)} onChange={() => toggleSelect(deal.id)} /></td>
                    <td><Link to={`/crm/${deal.id}`}>{deal.title}</Link></td>
                    <td>
                      {deal.contact_id ? (
                        <Link to={`/contacts/${deal.contact_id}`}>
                          {contactDisplayLabel({ display_name: deal.contact_name, external_address: deal.contact_phone ?? "" })}
                        </Link>
                      ) : "—"}
                    </td>
                    <td><span className={`crm-stage-pill ${STAGE_COLORS[deal.stage]}`}>{STAGE_LABELS[deal.stage]}</span></td>
                    <td>{formatDealAmount(deal)}</td>
                    <td>{deal.organization_id ? orgMap.get(deal.organization_id) ?? "—" : "—"}</td>
                    <td>{deal.probability}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function DealCard({
  deal,
  orgMap,
  selected,
  onToggleSelect,
  onMoveStage
}: {
  deal: Deal;
  orgMap: Map<string, string>;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onMoveStage: (dealId: string, stage: DealStage) => void;
}) {
  return (
    <article
      className={`pipeline-card crm-deal-card ${selected ? "crm-deal-selected" : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("dealId", deal.id)}
    >
      <label className="crm-deal-check">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(deal.id)} />
      </label>
      <Link to={`/crm/${deal.id}`} className="crm-deal-title">{deal.title}</Link>
      <p className="crm-deal-amount">{formatDealAmount(deal)}</p>
      {deal.contact_id && (
        <Link to={`/contacts/${deal.contact_id}`} className="crm-deal-contact">
          {contactDisplayLabel({ display_name: deal.contact_name, external_address: deal.contact_phone ?? "" })}
        </Link>
      )}
      {deal.organization_id && <small className="hint-text">{orgMap.get(deal.organization_id)}</small>}
      {deal.source === "inbound" && <span className="crm-source-badge">WhatsApp</span>}
      <select value={deal.stage} onChange={(e) => void onMoveStage(deal.id, e.target.value as DealStage)}>
        {DEAL_STAGES.map((stage) => (
          <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
        ))}
      </select>
    </article>
  );
}
