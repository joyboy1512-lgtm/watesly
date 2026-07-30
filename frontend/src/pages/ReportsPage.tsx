import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../lib/api";
import {
  CampaignResultsTable,
  type CampaignSummaryRow
} from "../components/CampaignRecipientsPanel";
import { STAGE_LABELS, formatDealAmount, type CrmReport } from "../lib/crmHelpers";
import {
  REPORT_TABS,
  type ContactRow,
  type ReportTab,
  type ReportTabId,
  changeClass,
  downloadReport,
  formatChange,
  loadSavedReportTab,
  saveReportTab
} from "../lib/reportsHelpers";

type Overview = {
  period_days: number;
  total_contacts: number;
  new_contacts: number;
  contacts_with_name: number;
  contacts_without_name: number;
  two_way_engaged: number;
  waiting_team_reply: number;
  waiting_customer_reply: number;
  no_interaction: number;
  campaigns_in_period: number;
  open_conversations: number;
  sla_breaches: number;
  inactive_contacts: number;
  changes_pct?: Record<string, number | null>;
};

type AnalyticsInsight = {
  level: "success" | "warning" | "critical" | "info";
  code: string;
  title: string;
  message: string;
  action_path: string | null;
};

type ExecutiveReport = {
  period_days: number;
  generated_at: string;
  overview: Overview;
  crm: CrmReport["summary"];
  csat: { average_score: number | null; total_ratings: number; promoters_pct: number | null };
  sla: Record<string, number | null>;
  roi: { campaigns: number; deals_created: number; deals_won: number; won_value: number };
  insights: AnalyticsInsight[];
};

type AgentRow = {
  membership_id: string;
  user_name: string;
  role: string;
  open_conversations: number;
  closed_conversations: number;
  first_response_avg_minutes: number | null;
  sla_compliance_pct: number | null;
  csat_average: number | null;
  csat_count: number;
  deals_won: number;
};

const TAB_GROUPS: { label: string; ids: ReportTabId[] }[] = [
  { label: "ملخص", ids: ["executive", "overview"] },
  { label: "العملاء", ids: ["customers", "compliance", "names", "engagement", "inactivity"] },
  { label: "التسويق", ids: ["campaigns", "roi"] },
  { label: "العمليات", ids: ["conversations", "team", "quick-replies", "automations", "whatsapp"] },
  { label: "المحتوى", ids: ["catalog", "knowledge", "crm", "audit"] }
];

const CHART_COLORS = ["#128c7e", "#25d366", "#075e54", "#34b7f1", "#f59e0b", "#ef4444"];

function resolveInitialTab(urlTab: string | null): ReportTabId {
  if (urlTab && REPORT_TABS.some((item) => item.id === urlTab)) return urlTab as ReportTabId;
  return loadSavedReportTab() ?? "overview";
}

function ExportButtons({ exportPath, baseName, days }: { exportPath?: string; baseName: string; days?: number }) {
  if (!exportPath) return null;
  return (
    <div className="inline-actions">
      <button
        type="button"
        className="whatsapp-button"
        onClick={() => void downloadReport(exportPath, `${baseName}.xlsx`, "xlsx", days)}
      >
        تصدير Excel
      </button>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void downloadReport(exportPath, `${baseName}.csv`, "csv", days)}
      >
        CSV
      </button>
    </div>
  );
}

function MetricCard({
  label,
  value,
  change,
  href
}: {
  label: string;
  value: string | number;
  change?: number | null;
  href?: string;
}) {
  const body = (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {change != null && (
        <small className={`reports-metric-change ${changeClass(change)}`}>{formatChange(change)} vs السابق</small>
      )}
    </article>
  );
  if (href) {
    return (
      <Link to={href} className="reports-drill-link">
        {body}
      </Link>
    );
  }
  return body;
}

function SectionHeader({ tabDef, days }: { tabDef: ReportTab; days: number }) {
  return (
    <div className="reports-section-header">
      <h2 className="section-title">{tabDef.label}</h2>
      <div className="reports-erp-header-actions">
        {tabDef.analyticsLink && (
          <Link to={tabDef.analyticsLink} className="secondary-button">
            التحليلات
          </Link>
        )}
        <ExportButtons exportPath={tabDef.exportPath} baseName={`${tabDef.id}-report`} days={tabDef.period ? days : undefined} />
      </div>
    </div>
  );
}

function ContactsTable({
  rows,
  emptyLabel,
  showLastMessage
}: {
  rows: ContactRow[];
  emptyLabel: string;
  showLastMessage?: boolean;
}) {
  if (!rows.length) return <p className="hint-text">{emptyLabel}</p>;
  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>الاسم</th>
            <th>الرقم</th>
            <th>البريد</th>
            {showLastMessage && <th>آخر رسالة</th>}
            <th>تاريخ الإضافة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td>{item.display_name || "—"}</td>
              <td dir="ltr">{item.phone}</td>
              <td dir="ltr">{item.email || "—"}</td>
              {showLastMessage && (
                <td>{item.last_message_at ? new Date(item.last_message_at).toLocaleString("ar") : "—"}</td>
              )}
              <td>{item.created_at ? new Date(item.created_at).toLocaleString("ar") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsBarChart({
  data,
  xKey,
  bars
}: {
  data: Record<string, string | number>[];
  xKey: string;
  bars: { key: string; name: string; color?: string }[];
}) {
  if (!data.length) return <p className="hint-text">لا توجد بيانات للعرض.</p>;
  return (
    <div className="reports-chart-card card">
      <div className="reports-chart-wrap">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {bars.map((bar, index) => (
              <Bar key={bar.key} dataKey={bar.key} name={bar.name} fill={bar.color ?? CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const [tab, setTab] = useState<ReportTabId>(() => resolveInitialTab(urlTab));
  const [days, setDays] = useState(30);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);

  const currentTab = REPORT_TABS.find((item) => item.id === tab) ?? REPORT_TABS[1];

  useEffect(() => {
    if (urlTab && REPORT_TABS.some((item) => item.id === urlTab)) {
      setTab(urlTab as ReportTabId);
      saveReportTab(urlTab as ReportTabId);
    }
  }, [urlTab]);

  function selectTab(next: ReportTabId) {
    setTab(next);
    saveReportTab(next);
    setSearchParams({ tab: next }, { replace: true });
  }

  const executive = useQuery({
    queryKey: ["reports-executive", days],
    queryFn: async () => (await api.get<ExecutiveReport>("/reports/executive", { params: { days } })).data,
    enabled: tab === "executive"
  });
  const overview = useQuery({
    queryKey: ["reports-overview", days],
    queryFn: async () => (await api.get<Overview>("/reports/overview", { params: { days } })).data,
    enabled: tab === "overview" || tab === "executive"
  });
  const customers = useQuery({
    queryKey: ["reports-customers", days],
    queryFn: async () => (await api.get("/reports/customers", { params: { days } })).data,
    enabled: tab === "customers"
  });
  const compliance = useQuery({
    queryKey: ["reports-compliance"],
    queryFn: async () => (await api.get("/reports/compliance")).data,
    enabled: tab === "compliance"
  });
  const names = useQuery({
    queryKey: ["reports-names"],
    queryFn: async () => (await api.get("/reports/names")).data,
    enabled: tab === "names"
  });
  const engagement = useQuery({
    queryKey: ["reports-engagement", days],
    queryFn: async () => (await api.get("/reports/engagement", { params: { days } })).data,
    enabled: tab === "engagement"
  });
  const campaigns = useQuery({
    queryKey: ["reports-campaigns", days],
    queryFn: async () => (await api.get("/reports/campaigns", { params: { days } })).data,
    enabled: tab === "campaigns"
  });
  const roi = useQuery({
    queryKey: ["reports-roi", days],
    queryFn: async () => (await api.get("/reports/roi", { params: { days } })).data,
    enabled: tab === "roi"
  });
  const conversations = useQuery({
    queryKey: ["reports-conversations", days],
    queryFn: async () => (await api.get("/reports/conversations", { params: { days } })).data,
    enabled: tab === "conversations"
  });
  const team = useQuery({
    queryKey: ["reports-team", days],
    queryFn: async () => (await api.get<{ period_days: number; summary: Record<string, unknown>; agents: AgentRow[] }>("/reports/team", { params: { days } })).data,
    enabled: tab === "team"
  });
  const quickReplies = useQuery({
    queryKey: ["reports-quick-replies"],
    queryFn: async () => (await api.get("/reports/quick-replies")).data,
    enabled: tab === "quick-replies"
  });
  const automations = useQuery({
    queryKey: ["reports-automations", days],
    queryFn: async () => (await api.get("/reports/automations", { params: { days } })).data,
    enabled: tab === "automations"
  });
  const whatsapp = useQuery({
    queryKey: ["reports-whatsapp"],
    queryFn: async () => (await api.get("/reports/whatsapp")).data,
    enabled: tab === "whatsapp"
  });
  const inactivity = useQuery({
    queryKey: ["reports-inactivity", days],
    queryFn: async () => (await api.get("/reports/inactivity", { params: { days } })).data,
    enabled: tab === "inactivity"
  });
  const catalog = useQuery({
    queryKey: ["reports-catalog"],
    queryFn: async () => (await api.get("/reports/catalog")).data,
    enabled: tab === "catalog"
  });
  const knowledge = useQuery({
    queryKey: ["reports-knowledge"],
    queryFn: async () => (await api.get("/reports/knowledge")).data,
    enabled: tab === "knowledge"
  });
  const crm = useQuery({
    queryKey: ["reports-crm"],
    queryFn: async () => (await api.get<CrmReport>("/reports/crm")).data,
    enabled: tab === "crm"
  });
  const audit = useQuery({
    queryKey: ["reports-audit", days],
    queryFn: async () => (await api.get("/reports/audit", { params: { days } })).data,
    enabled: tab === "audit"
  });

  const overviewChart = useMemo(() => {
    const data = overview.data;
    if (!data) return [];
    return [
      { metric: "عملاء جدد", value: data.new_contacts },
      { metric: "محادثات مفتوحة", value: data.open_conversations },
      { metric: "تجاوز SLA", value: data.sla_breaches },
      { metric: "حملات", value: data.campaigns_in_period },
      { metric: "تجاوب ثنائي", value: data.two_way_engaged },
      { metric: "غير نشطين", value: data.inactive_contacts }
    ];
  }, [overview.data]);

  const complianceChart = useMemo(() => {
    const summary = compliance.data?.summary;
    if (!summary) return [];
    const unknown = Math.max(
      0,
      (summary.total_contacts ?? 0) - (summary.marketing_opt_in ?? 0) - (summary.marketing_opt_out ?? 0)
    );
    return [
      { name: "موافقة", value: summary.marketing_opt_in ?? 0, color: CHART_COLORS[1] },
      { name: "رفض", value: summary.marketing_opt_out ?? 0, color: CHART_COLORS[5] },
      { name: "غير محدد", value: unknown, color: CHART_COLORS[3] }
    ].filter((item) => item.value > 0);
  }, [compliance.data]);

  const engagementChart = useMemo(() => {
    const summary = engagement.data?.summary;
    if (!summary) return [];
    return [
      { status: "تجاوب ثنائي", count: summary.two_way_engaged ?? 0 },
      { status: "بانتظار الفريق", count: summary.waiting_team_reply ?? 0 },
      { status: "بانتظار العميل", count: summary.waiting_customer_reply ?? 0 },
      { status: "بدون تفاعل", count: summary.no_interaction ?? 0 }
    ];
  }, [engagement.data]);

  const teamChart = useMemo(
    () =>
      (team.data?.agents ?? []).slice(0, 8).map((agent) => ({
        name: agent.user_name,
        open: agent.open_conversations,
        closed: agent.closed_conversations
      })),
    [team.data]
  );

  const roiChart = useMemo(() => {
    const summary = roi.data?.summary;
    if (!summary) return [];
    return [
      { metric: "حملات", value: summary.campaigns ?? 0 },
      { metric: "صفقات جديدة", value: summary.deals_created ?? 0 },
      { metric: "صفقات رابحة", value: summary.deals_won ?? 0 }
    ];
  }, [roi.data]);

  const auditChart = useMemo(
    () => (audit.data?.by_action ?? []).slice(0, 8).map((item: { action: string; count: number }) => ({
      action: item.action,
      count: item.count
    })),
    [audit.data]
  );

  const catalogChart = useMemo(() => {
    const summary = catalog.data?.summary;
    if (!summary) return [];
    return [
      { type: "منتجات", count: summary.products ?? 0 },
      { type: "خدمات", count: summary.services ?? 0 },
      { type: "بدون سعر", count: summary.without_price ?? 0 },
      { type: "بدون صورة", count: summary.without_image ?? 0 }
    ];
  }, [catalog.data]);

  const knowledgeChart = useMemo(
    () => (knowledge.data?.by_category ?? []).map((item: { category: string; count: number }) => ({
      category: item.category,
      count: item.count
    })),
    [knowledge.data]
  );

  const campaignsChart = useMemo(() => {
    const summary = campaigns.data?.summary;
    if (!summary) return [];
    return [
      { metric: "حملات", value: summary.campaigns ?? 0 },
      { metric: "مستلمين", value: summary.recipients ?? 0 },
      { metric: "مقروء", value: summary.read ?? 0 }
    ];
  }, [campaigns.data]);

  const crmChart = useMemo(
    () =>
      (crm.data?.funnel ?? []).map((item) => ({
        stage: STAGE_LABELS[item.stage as keyof typeof STAGE_LABELS] ?? item.stage,
        count: item.count
      })),
    [crm.data]
  );

  return (
    <main className="page reports-page">
      <header className="reports-erp-header card">
        <div>
          <p className="reports-erp-eyebrow">{t("eyebrow.businessReports")}</p>
          <h1>{t("pages.reports")}</h1>
          <p>18 تقريراً تشغيلياً: عملاء، امتثال، فريق، حملات، ROI، WhatsApp، CRM، وتدقيق.</p>
        </div>
        <div className="reports-erp-header-actions">
          {currentTab.period && (
            <label className="field-label reports-period">
              <span>الفترة</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>7 أيام</option>
                <option value={30}>30 يوم</option>
                <option value={90}>90 يوم</option>
              </select>
            </label>
          )}
          <ExportButtons
            exportPath={currentTab.exportPath}
            baseName={`${currentTab.id}-report`}
            days={currentTab.period ? days : undefined}
          />
          <Link to="/analytics" className="secondary-button">
            التحليلات
          </Link>
        </div>
      </header>

      <section className="card reports-toolbar">
        <div className="reports-tab-groups">
          {TAB_GROUPS.map((group) => (
            <div key={group.label} className="reports-tab-group">
              <span className="reports-tab-group-label">{group.label}</span>
              <div className="reports-tabs">
                {group.ids.map((id) => {
                  const item = REPORT_TABS.find((tabItem) => tabItem.id === id);
                  if (!item) return null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={tab === item.id ? "reports-tab active" : "reports-tab"}
                      onClick={() => selectTab(item.id)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {tab === "executive" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي العملاء" value={executive.data?.overview.total_contacts ?? "…"} href="/contacts" />
            <MetricCard
              label="عملاء جدد"
              value={executive.data?.overview.new_contacts ?? "…"}
              change={executive.data?.overview.changes_pct?.new_contacts}
              href="/contacts"
            />
            <MetricCard label="Pipeline CRM" value={executive.data?.crm.pipeline_value ?? "…"} href="/crm" />
            <MetricCard label="فوز (30 يوم)" value={executive.data?.crm.won_value_month ?? "…"} href="/crm" />
            <MetricCard label="تجاوز SLA" value={executive.data?.overview.sla_breaches ?? "…"} href="/inbox" />
            <MetricCard label="قيمة ROI" value={executive.data?.roi.won_value ?? "…"} href="/crm" />
            <MetricCard label="CSAT" value={executive.data?.csat.average_score ?? "—"} />
            <MetricCard label="امتثال SLA %" value={executive.data?.sla.sla_compliance_pct ?? "—"} />
          </div>
          <h3 className="section-title-sm">رؤى ذكية</h3>
          <div className="reports-insight-list">
            {(executive.data?.insights ?? []).map((insight) => (
              <article key={insight.code} className={`reports-insight reports-insight-${insight.level}`}>
                <strong>{insight.title}</strong>
                <p>{insight.message}</p>
                {insight.action_path && (
                  <Link to={insight.action_path} className="reports-drill-link">
                    عرض التفاصيل ←
                  </Link>
                )}
              </article>
            ))}
            {!executive.data?.insights?.length && <p className="hint-text">لا توجد رؤى في هذه الفترة.</p>}
          </div>
        </section>
      )}

      {tab === "overview" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي العملاء" value={overview.data?.total_contacts ?? "…"} href="/contacts" />
            <MetricCard
              label="عملاء جدد"
              value={overview.data?.new_contacts ?? "…"}
              change={overview.data?.changes_pct?.new_contacts}
              href="/contacts"
            />
            <MetricCard label="حملات" value={overview.data?.campaigns_in_period ?? "…"} />
            <MetricCard label="محادثات مفتوحة" value={overview.data?.open_conversations ?? "…"} href="/inbox" />
            <MetricCard label="تجاوز SLA" value={overview.data?.sla_breaches ?? "…"} href="/inbox" />
            <MetricCard label="غير نشطين" value={overview.data?.inactive_contacts ?? "…"} href="/contacts" />
            <MetricCard label="تجاوب ثنائي" value={overview.data?.two_way_engaged ?? "…"} />
            <MetricCard label="بانتظار الفريق" value={overview.data?.waiting_team_reply ?? "…"} href="/inbox" />
          </div>
          <ReportsBarChart data={overviewChart} xKey="metric" bars={[{ key: "value", name: "العدد", color: CHART_COLORS[0] }]} />
        </section>
      )}

      {tab === "customers" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي" value={customers.data?.summary?.total_contacts ?? "…"} href="/contacts" />
            <MetricCard label="جدد" value={customers.data?.summary?.new_contacts ?? "…"} href="/contacts" />
            <MetricCard label="لديهم بريد" value={customers.data?.summary?.with_email ?? "…"} />
            <MetricCard label="لديهم محادثات" value={customers.data?.summary?.with_conversations ?? "…"} href="/inbox" />
          </div>
          <ContactsTable rows={customers.data?.recent_contacts ?? []} emptyLabel="لا يوجد عملاء." />
        </section>
      )}

      {tab === "compliance" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي العملاء" value={compliance.data?.summary?.total_contacts ?? "…"} href="/contacts" />
            <MetricCard label="موافقة تسويق" value={compliance.data?.summary?.marketing_opt_in ?? "…"} />
            <MetricCard label="رفض تسويق" value={compliance.data?.summary?.marketing_opt_out ?? "…"} />
            <MetricCard label="بدون بريد" value={compliance.data?.summary?.without_email ?? "…"} />
            <MetricCard label="بدون اسم" value={compliance.data?.summary?.without_name ?? "…"} />
            <MetricCard label="أرقام مكررة" value={compliance.data?.summary?.duplicate_phones ?? "…"} />
          </div>
          {complianceChart.length > 0 && (
            <div className="reports-chart-card card">
              <h3 className="section-title-sm">الموافقة التسويقية</h3>
              <div className="reports-chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={complianceChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {complianceChart.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <h3 className="section-title-sm">عملاء رفضوا التسويق</h3>
          <ContactsTable
            rows={(compliance.data?.opt_out_contacts ?? []).map((item: ContactRow) => ({
              ...item,
              created_at: item.created_at ?? null
            }))}
            emptyLabel="لا يوجد."
          />
        </section>
      )}

      {tab === "names" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="لديهم اسم" value={names.data?.summary?.with_name ?? "…"} />
            <MetricCard label="بدون اسم" value={names.data?.summary?.without_name ?? "…"} href="/contacts" />
            <MetricCard label="أسماء مكررة" value={names.data?.summary?.duplicate_name_groups ?? "…"} />
          </div>
          <ContactsTable rows={names.data?.missing_names ?? []} emptyLabel="كل العملاء لديهم أسماء." />
        </section>
      )}

      {tab === "engagement" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="تجاوب ثنائي" value={engagement.data?.summary?.two_way_engaged ?? "…"} />
            <MetricCard label="بانتظار الفريق" value={engagement.data?.summary?.waiting_team_reply ?? "…"} href="/inbox" />
            <MetricCard label="بانتظار العميل" value={engagement.data?.summary?.waiting_customer_reply ?? "…"} />
            <MetricCard label="بدون تفاعل" value={engagement.data?.summary?.no_interaction ?? "…"} />
          </div>
          <ReportsBarChart
            data={engagementChart}
            xKey="status"
            bars={[{ key: "count", name: "العملاء", color: CHART_COLORS[0] }]}
          />
          <ContactsTable rows={engagement.data?.waiting_team_reply ?? []} emptyLabel="لا يوجد." />
        </section>
      )}

      {tab === "campaigns" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="عدد الحملات" value={campaigns.data?.summary?.campaigns ?? "…"} />
            <MetricCard label="المستلمين" value={campaigns.data?.summary?.recipients ?? "…"} />
            <MetricCard label="مقروء" value={campaigns.data?.summary?.read ?? "…"} />
            <MetricCard
              label="نسبة التسليم"
              value={campaigns.data?.summary?.delivery_rate != null ? `${campaigns.data.summary.delivery_rate}%` : "…"}
            />
          </div>
          <ReportsBarChart
            data={campaignsChart}
            xKey="metric"
            bars={[{ key: "value", name: "العدد", color: CHART_COLORS[2] }]}
          />
          <CampaignResultsTable
            items={(campaigns.data?.campaigns ?? []) as CampaignSummaryRow[]}
            expandedCampaignId={expandedCampaignId}
            onToggleExpanded={(id) => setExpandedCampaignId((current) => (current === id ? null : id))}
            emptyLabel="لا توجد حملات في هذه الفترة."
          />
        </section>
      )}

      {tab === "roi" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="حملات" value={roi.data?.summary?.campaigns ?? "…"} />
            <MetricCard label="صفقات جديدة" value={roi.data?.summary?.deals_created ?? "…"} href="/crm" />
            <MetricCard label="صفقات رابحة" value={roi.data?.summary?.deals_won ?? "…"} href="/crm" />
            <MetricCard label="قيمة الفوز" value={roi.data?.summary?.won_value ?? "…"} href="/crm" />
          </div>
          <ReportsBarChart data={roiChart} xKey="metric" bars={[{ key: "value", name: "العدد", color: CHART_COLORS[1] }]} />
          <h3 className="section-title-sm">آخر الصفقات الرابحة</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الصفقة</th>
                  <th>القيمة</th>
                  <th>المصدر</th>
                </tr>
              </thead>
              <tbody>
                {(roi.data?.recent_won ?? []).map((deal: { id: string; title: string; amount: string; currency: string; source: string }) => (
                  <tr key={deal.id}>
                    <td>
                      <Link to="/crm" className="reports-drill-link">
                        {deal.title}
                      </Link>
                    </td>
                    <td>
                      {deal.amount} {deal.currency}
                    </td>
                    <td>{deal.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "conversations" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="مفتوحة" value={conversations.data?.summary?.open ?? "…"} href="/inbox" />
            <MetricCard label="مغلقة" value={conversations.data?.summary?.closed ?? "…"} />
            <MetricCard label="تجاوز SLA" value={conversations.data?.summary?.sla_breaches ?? "…"} href="/inbox" />
            <MetricCard label="متوسط أول رد (د)" value={conversations.data?.summary?.avg_first_response_minutes ?? "—"} />
          </div>
          <h3 className="section-title-sm">
            محادثات تجاوزت SLA ({conversations.data?.sla_target_minutes ?? 15} د) —{" "}
            <Link to="/inbox" className="reports-drill-link">
              فتح صندوق الوارد
            </Link>
          </h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الرقم</th>
                  <th>الحالة</th>
                  <th>انتظار (د)</th>
                </tr>
              </thead>
              <tbody>
                {(conversations.data?.sla_breaches ?? []).map((item: ContactRow) => (
                  <tr key={item.id}>
                    <td>{item.display_name || "—"}</td>
                    <td dir="ltr">{item.phone}</td>
                    <td>{item.status || "—"}</td>
                    <td>{item.waiting_minutes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "team" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="متوسط أول رد (د)" value={(team.data?.summary?.first_response_avg_minutes as number | null) ?? "—"} />
            <MetricCard label="امتثال SLA %" value={(team.data?.summary?.sla_compliance_pct as number | null) ?? "—"} />
            <MetricCard label="CSAT" value={(team.data?.summary?.csat as { average_score?: number })?.average_score ?? "—"} />
            <MetricCard label="تقييمات CSAT" value={(team.data?.summary?.csat as { total_ratings?: number })?.total_ratings ?? "—"} />
          </div>
          <ReportsBarChart
            data={teamChart}
            xKey="name"
            bars={[
              { key: "open", name: "مفتوحة", color: CHART_COLORS[3] },
              { key: "closed", name: "مغلقة", color: CHART_COLORS[1] }
            ]}
          />
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>العضو</th>
                  <th>الدور</th>
                  <th>مفتوحة</th>
                  <th>مغلقة</th>
                  <th>أول رد (د)</th>
                  <th>SLA %</th>
                  <th>CSAT</th>
                  <th>صفقات</th>
                </tr>
              </thead>
              <tbody>
                {(team.data?.agents ?? []).map((agent) => (
                  <tr key={agent.membership_id}>
                    <td>{agent.user_name}</td>
                    <td>{agent.role}</td>
                    <td>{agent.open_conversations}</td>
                    <td>{agent.closed_conversations}</td>
                    <td>{agent.first_response_avg_minutes ?? "—"}</td>
                    <td>{agent.sla_compliance_pct ?? "—"}</td>
                    <td>{agent.csat_average ?? "—"}</td>
                    <td>
                      <Link to="/crm" className="reports-drill-link">
                        {agent.deals_won}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "quick-replies" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي الردود" value={quickReplies.data?.summary?.total ?? "…"} />
            <MetricCard label="بدون استخدام" value={quickReplies.data?.summary?.unused ?? "…"} />
            <MetricCard label="إجمالي الاستخدام" value={quickReplies.data?.summary?.total_usage ?? "…"} />
          </div>
          <ReportsBarChart
            data={(quickReplies.data?.by_category ?? []).map((item: { category: string; count: number }) => ({
              category: item.category,
              count: item.count
            }))}
            xKey="category"
            bars={[{ key: "count", name: "الردود", color: CHART_COLORS[0] }]}
          />
          <h3 className="section-title-sm">الأكثر استخداماً</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الاختصار</th>
                  <th>العنوان</th>
                  <th>الفئة</th>
                  <th>الاستخدام</th>
                </tr>
              </thead>
              <tbody>
                {(quickReplies.data?.top_used ?? []).map((item: { id: string; shortcut: string; title: string; category: string; usage_count: number }) => (
                  <tr key={item.id}>
                    <td dir="ltr">{item.shortcut}</td>
                    <td>{item.title}</td>
                    <td>{item.category}</td>
                    <td>{item.usage_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "automations" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="الأتمتة" value={automations.data?.summary?.automations ?? "…"} />
            <MetricCard label="تشغيلات" value={automations.data?.summary?.total_runs ?? "…"} />
            <MetricCard label="نجاح" value={automations.data?.summary?.succeeded ?? "…"} />
            <MetricCard label="فشل" value={automations.data?.summary?.failed ?? "…"} />
            <MetricCard
              label="نسبة النجاح"
              value={automations.data?.summary?.success_rate != null ? `${automations.data.summary.success_rate}%` : "—"}
            />
          </div>
          <ReportsBarChart
            data={(automations.data?.automations ?? []).slice(0, 8).map((item: { name: string; runs: number; succeeded: number; failed: number }) => ({
              name: item.name,
              succeeded: item.succeeded,
              failed: item.failed
            }))}
            xKey="name"
            bars={[
              { key: "succeeded", name: "نجاح", color: CHART_COLORS[1] },
              { key: "failed", name: "فشل", color: CHART_COLORS[5] }
            ]}
          />
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الحالة</th>
                  <th>المحفّز</th>
                  <th>تشغيلات</th>
                  <th>نجاح</th>
                  <th>فشل</th>
                  <th>النسبة</th>
                </tr>
              </thead>
              <tbody>
                {(automations.data?.automations ?? []).map((item: { id: string; name: string; status: string; trigger_type: string; runs: number; succeeded: number; failed: number; success_rate: number | null }) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.status}</td>
                    <td>{item.trigger_type}</td>
                    <td>{item.runs}</td>
                    <td>{item.succeeded}</td>
                    <td>{item.failed}</td>
                    <td>{item.success_rate != null ? `${item.success_rate}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "whatsapp" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="خطوط متصلة" value={whatsapp.data?.summary?.connected_lines ?? "…"} />
            <MetricCard label="خطوط نشطة" value={whatsapp.data?.summary?.active_lines ?? "…"} />
            <MetricCard label="قوالب معلّقة" value={whatsapp.data?.summary?.pending_templates ?? "…"} />
            <MetricCard label="قوالب مرفوضة" value={whatsapp.data?.summary?.rejected_templates ?? "…"} />
          </div>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>الاسم المعتمد</th>
                  <th>الحالة</th>
                  <th>الجودة</th>
                  <th>حد الإرسال</th>
                  <th>آخر مزامنة</th>
                </tr>
              </thead>
              <tbody>
                {(whatsapp.data?.accounts ?? []).map((account: { id: string; display_phone_number: string; verified_name: string; status: string; quality_rating: string | null; messaging_limit_tier: string | null; health_synced_at: string | null }) => (
                  <tr key={account.id}>
                    <td dir="ltr">{account.display_phone_number || "—"}</td>
                    <td>{account.verified_name || "—"}</td>
                    <td>{account.status}</td>
                    <td>{account.quality_rating || "—"}</td>
                    <td>{account.messaging_limit_tier || "—"}</td>
                    <td>{account.health_synced_at ? new Date(account.health_synced_at).toLocaleString("ar") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "inactivity" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="لم يراسلوا أبداً" value={inactivity.data?.summary?.never_messaged ?? "…"} href="/contacts" />
            <MetricCard label="خاملين" value={inactivity.data?.summary?.dormant ?? "…"} href="/contacts" />
            <MetricCard label="إجمالي غير نشط" value={inactivity.data?.summary?.total_inactive ?? "…"} href="/contacts" />
          </div>
          <h3 className="section-title-sm">عملاء خاملين (آخر رسالة قبل {days} يوم)</h3>
          <ContactsTable rows={inactivity.data?.dormant ?? []} emptyLabel="لا يوجد عملاء خاملين." showLastMessage />
        </section>
      )}

      {tab === "catalog" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي" value={catalog.data?.summary?.total ?? "…"} />
            <MetricCard label="منتجات" value={catalog.data?.summary?.products ?? "…"} />
            <MetricCard label="خدمات" value={catalog.data?.summary?.services ?? "…"} />
            <MetricCard label="بدون سعر" value={catalog.data?.summary?.without_price ?? "…"} />
            <MetricCard label="بدون صورة" value={catalog.data?.summary?.without_image ?? "…"} />
          </div>
          <ReportsBarChart data={catalogChart} xKey="type" bars={[{ key: "count", name: "العدد", color: CHART_COLORS[2] }]} />
          <h3 className="section-title-sm">بدون صورة</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>النوع</th>
                  <th>السعر</th>
                  <th>نوع السعر</th>
                </tr>
              </thead>
              <tbody>
                {(catalog.data?.without_image ?? []).map((item: { id: string; name: string; product_type: string; price: string | null; price_type: string }) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.product_type === "service" ? "خدمة" : "منتج"}</td>
                    <td>{item.price || "—"}</td>
                    <td>{item.price_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "knowledge" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي المقالات" value={knowledge.data?.summary?.total ?? "…"} />
            <MetricCard label="بدون استخدام" value={knowledge.data?.summary?.unused ?? "…"} />
            <MetricCard label="إجمالي الاستخدام" value={knowledge.data?.summary?.total_usage ?? "…"} />
          </div>
          <ReportsBarChart data={knowledgeChart} xKey="category" bars={[{ key: "count", name: "المقالات", color: CHART_COLORS[0] }]} />
          <h3 className="section-title-sm">الأكثر استخداماً</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>العنوان</th>
                  <th>الفئة</th>
                  <th>الاستخدام</th>
                </tr>
              </thead>
              <tbody>
                {(knowledge.data?.top_used ?? []).map((item: { id: string; title: string; category: string; usage_count: number }) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.category}</td>
                    <td>{item.usage_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "crm" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي الصفقات" value={crm.data?.summary?.total ?? "…"} href="/crm" />
            <MetricCard label="مفتوحة" value={crm.data?.summary?.open ?? "…"} href="/crm" />
            <MetricCard label="فوز (30 يوم)" value={crm.data?.summary?.won_month ?? "…"} href="/crm" />
            <MetricCard label="قيمة Pipeline" value={crm.data?.summary?.pipeline_value ?? "…"} href="/crm" />
            <MetricCard label="قيمة الفوز (30 يوم)" value={crm.data?.summary?.won_value_month ?? "…"} href="/crm" />
          </div>
          <ReportsBarChart data={crmChart} xKey="stage" bars={[{ key: "count", name: "الصفقات", color: CHART_COLORS[1] }]} />
          <h3 className="section-title-sm">
            قمع المبيعات —{" "}
            <Link to="/crm" className="reports-drill-link">
              فتح CRM
            </Link>
          </h3>
          <div className="crm-funnel">
            {(crm.data?.funnel ?? []).map((item) => (
              <button key={item.stage} type="button" className="crm-funnel-step" style={{ flex: Math.max(item.count, 1) }}>
                <span>{STAGE_LABELS[item.stage as keyof typeof STAGE_LABELS] ?? item.stage}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </div>
          <h3 className="section-title-sm">أهم الصفقات المفتوحة</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الصفقة</th>
                  <th>المرحلة</th>
                  <th>القيمة</th>
                  <th>العميل</th>
                </tr>
              </thead>
              <tbody>
                {(crm.data?.top_open ?? []).map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <Link to="/crm" className="reports-drill-link">
                        {deal.title}
                      </Link>
                    </td>
                    <td>{STAGE_LABELS[deal.stage]}</td>
                    <td>{formatDealAmount(deal)}</td>
                    <td>{deal.contact_name || deal.contact_phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="reports-section card">
          <SectionHeader tabDef={currentTab} days={days} />
          <div className="stats-grid">
            <MetricCard label="إجمالي الأحداث" value={audit.data?.summary?.total_events ?? "…"} />
            <MetricCard label="أنواع الإجراءات" value={audit.data?.summary?.unique_actions ?? "…"} />
          </div>
          <ReportsBarChart data={auditChart} xKey="action" bars={[{ key: "count", name: "الأحداث", color: CHART_COLORS[4] }]} />
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>الإجراء</th>
                  <th>النوع</th>
                  <th>المستخدم</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {(audit.data?.events ?? []).map((event: { id: string; action: string; resource_type: string; actor_name: string | null; created_at: string | null }) => (
                  <tr key={event.id}>
                    <td>{event.action}</td>
                    <td>{event.resource_type}</td>
                    <td>{event.actor_name || "—"}</td>
                    <td>{event.created_at ? new Date(event.created_at).toLocaleString("ar") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
