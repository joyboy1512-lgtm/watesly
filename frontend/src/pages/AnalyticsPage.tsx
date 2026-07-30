import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api } from "../lib/api";
import {
  type AnalyticsInsight,
  type AnalyticsOverview,
  type AnalyticsTab,
  type AgentRow,
  type CampaignAnalytics,
  type CustomerFunnel,
  type RevenueAnalytics,
  type TimeSeriesPoint,
  DAY_LABELS,
  STAGE_LABELS,
  changeClass,
  downloadAnalyticsExport,
  formatChange
} from "../lib/analyticsHelpers";

const tabs: { id: AnalyticsTab; labelKey: string }[] = [
  { id: "live", labelKey: "analytics.tabLive" },
  { id: "team", labelKey: "analytics.tabTeam" },
  { id: "customers", labelKey: "analytics.tabCustomers" },
  { id: "revenue", labelKey: "analytics.tabRevenue" },
  { id: "insights", labelKey: "analytics.tabInsights" }
];

function PeriodSelect({ days, onChange }: { days: number; onChange: (value: number) => void }) {
  return (
    <label className="field-label analytics-period">
      <span>الفترة</span>
      <select value={days} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={7}>7 أيام</option>
        <option value={30}>30 يوم</option>
        <option value={90}>90 يوم</option>
      </select>
    </label>
  );
}

function KpiCard({
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
    <article className="analytics-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {change != null && <em className={changeClass(change)}>{formatChange(change)} vs السابق</em>}
    </article>
  );
  return href ? <Link to={href} className="analytics-kpi-link">{body}</Link> : body;
}

function Heatmap({ matrix, peak }: { matrix: number[][]; peak: number }) {
  return (
    <div className="analytics-heatmap">
      <div className="analytics-heatmap-hours">
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour}>{hour}</span>
        ))}
      </div>
      {matrix.map((row, dow) => (
        <div key={dow} className="analytics-heatmap-row">
          <span className="analytics-heatmap-day">{DAY_LABELS.current[dow]}</span>
          {row.map((count, hour) => {
            const intensity = peak > 0 ? count / peak : 0;
            return (
              <span
                key={`${dow}-${hour}`}
                className="analytics-heatmap-cell"
                style={{ background: `rgba(18, 140, 126, ${0.08 + intensity * 0.85})` }}
                title={`${DAY_LABELS.current[dow]} ${hour}:00 — ${count} رسالة`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<AnalyticsTab>(
    tabs.some((item) => item.id === initialTab) ? (initialTab as AnalyticsTab) : "live"
  );
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (initialTab && tabs.some((item) => item.id === initialTab)) {
      setTab(initialTab as AnalyticsTab);
    }
  }, [initialTab]);

  const overview = useQuery({
    queryKey: ["analytics-overview", days],
    queryFn: async () => (await api.get<AnalyticsOverview>("/platform/analytics/overview", { params: { days } })).data,
    refetchInterval: tab === "live" ? 15000 : false
  });
  const timeSeries = useQuery({
    queryKey: ["analytics-time-series", days],
    queryFn: async () => (await api.get<{ series: TimeSeriesPoint[] }>("/platform/analytics/time-series", { params: { days } })).data,
    enabled: tab === "live"
  });
  const heatmap = useQuery({
    queryKey: ["analytics-heatmap", days],
    queryFn: async () => (await api.get<{ matrix: number[][]; peak: number }>("/platform/analytics/heatmap", { params: { days } })).data,
    enabled: tab === "live"
  });
  const agents = useQuery({
    queryKey: ["analytics-agents", days],
    queryFn: async () => (await api.get<AgentRow[]>("/platform/analytics/agents", { params: { days } })).data,
    enabled: tab === "team"
  });
  const funnel = useQuery({
    queryKey: ["analytics-funnel", days],
    queryFn: async () => (await api.get<CustomerFunnel>("/platform/analytics/customer-funnel", { params: { days } })).data,
    enabled: tab === "customers"
  });
  const campaigns = useQuery({
    queryKey: ["analytics-campaigns", days],
    queryFn: async () => (await api.get<CampaignAnalytics>("/platform/analytics/campaigns", { params: { days } })).data,
    enabled: tab === "customers"
  });
  const revenue = useQuery({
    queryKey: ["analytics-revenue", days],
    queryFn: async () => (await api.get<RevenueAnalytics>("/platform/analytics/revenue", { params: { days } })).data,
    enabled: tab === "revenue"
  });
  const insights = useQuery({
    queryKey: ["analytics-insights", days],
    queryFn: async () => (await api.get<{ insights: AnalyticsInsight[] }>("/platform/analytics/insights", { params: { days } })).data,
    enabled: tab === "insights"
  });

  const chartData = useMemo(
    () =>
      (timeSeries.data?.series ?? []).map((point) => ({
        ...point,
        label: new Date(point.date).toLocaleDateString("ar", { month: "short", day: "numeric" })
      })),
    [timeSeries.data]
  );

  const csatChart = useMemo(() => {
    const byScore = overview.data?.csat.by_score ?? {};
    return [5, 4, 3, 2, 1].map((score) => ({
      score: `${score} ★`,
      count: byScore[String(score)] ?? 0
    }));
  }, [overview.data]);

  const revenueChart = useMemo(
    () =>
      (revenue.data?.funnel ?? []).map((item) => ({
        stage: STAGE_LABELS[item.stage] ?? item.stage,
        count: item.count
      })),
    [revenue.data]
  );

  const o = overview.data;

  return (
    <main className="page analytics-page">
      <header className="analytics-header">
        <div>
          <p className="analytics-eyebrow">WhatsApp Intelligence</p>
          <h1>{t("pages.analytics")}</h1>
          <p>لوحة موحدة: حية، فريق، عملاء، حملات، إيرادات، ورؤى ذكية.</p>
        </div>
        <div className="analytics-header-actions">
          <PeriodSelect days={days} onChange={setDays} />
          <button type="button" className="secondary-button" onClick={() => void downloadAnalyticsExport("/reports/overview/export", "analytics-overview.xlsx")}>
            تصدير Excel
          </button>
          <Link to="/reports" className="secondary-button">التقارير التفصيلية</Link>
        </div>
      </header>

      <section className="card analytics-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "analytics-tab active" : "analytics-tab"}
            onClick={() => setTab(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </section>

      {tab === "live" && (
        <>
          <section className="analytics-kpi-grid">
            <KpiCard label="محادثات مفتوحة" value={o?.live.open_conversations ?? "…"} href="/inbox" />
            <KpiCard label="بانتظار الفريق" value={o?.live.waiting_team_reply ?? "…"} href="/inbox" />
            <KpiCard label="رسائل اليوم" value={o?.live.messages_today ?? "…"} />
            <KpiCard label="SLA متجاوز" value={o?.sla.sla_breaches_open ?? "…"} href="/inbox" />
            <KpiCard label="متوسط أول رد (د)" value={o?.sla.first_response_avg_minutes ?? "—"} change={null} />
            <KpiCard label="SLA compliance" value={o?.sla.sla_compliance_pct != null ? `${o.sla.sla_compliance_pct}%` : "—"} />
            <KpiCard label="CSAT" value={o?.csat.average_score ?? "—"} />
            <KpiCard label="إيراد الفوز" value={o?.current.revenue_won ?? "…"} change={o?.changes_pct.revenue_won} href="/crm" />
          </section>

          <section className="card analytics-chart-card">
            <h2 className="section-title-sm">حركة الرسائل ({days} يوم)</h2>
            <div className="analytics-chart-wrap">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8edf2" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="inbound" name="واردة" stroke="#128c7e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="outbound" name="صادرة" stroke="#25d366" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card analytics-chart-card">
            <h2 className="section-title-sm">خريطة النشاط (يوم × ساعة)</h2>
            <Heatmap matrix={heatmap.data?.matrix ?? Array.from({ length: 7 }, () => Array(24).fill(0))} peak={heatmap.data?.peak ?? 0} />
          </section>

          <section className="analytics-kpi-grid">
            <KpiCard label="رسائل واردة" value={o?.current.messages_inbound ?? "…"} change={o?.changes_pct.messages_inbound} />
            <KpiCard label="رسائل صادرة" value={o?.current.messages_outbound ?? "…"} change={o?.changes_pct.messages_outbound} />
            <KpiCard label="محادثات جديدة" value={o?.current.conversations ?? "…"} change={o?.changes_pct.conversations} />
            <KpiCard label="عملاء جدد" value={o?.current.new_contacts ?? "…"} change={o?.changes_pct.new_contacts} href="/contacts" />
          </section>
        </>
      )}

      {tab === "team" && (
        <>
          <section className="card analytics-chart-card">
            <h2 className="section-title-sm">توزيع CSAT</h2>
            <div className="analytics-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={csatChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8edf2" />
                  <XAxis dataKey="score" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="تقييمات" fill="#128c7e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="card table-card">
            <h2 className="section-title-sm">أداء الموظفين</h2>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الدور</th>
                  <th>مفتوحة</th>
                  <th>مغلقة</th>
                  <th>أول رد (د)</th>
                  <th>SLA %</th>
                  <th>CSAT</th>
                  <th>صفقات فوز</th>
                </tr>
              </thead>
              <tbody>
                {(agents.data ?? []).map((agent) => (
                  <tr key={agent.membership_id}>
                    <td>{agent.user_name}</td>
                    <td>{agent.role}</td>
                    <td>{agent.open_conversations}</td>
                    <td>{agent.closed_conversations}</td>
                    <td>{agent.first_response_avg_minutes ?? "—"}</td>
                    <td>{agent.sla_compliance_pct != null ? `${agent.sla_compliance_pct}%` : "—"}</td>
                    <td>{agent.csat_average ?? "—"}</td>
                    <td>{agent.deals_won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "customers" && (
        <>
          <section className="card analytics-chart-card">
            <h2 className="section-title-sm">قمع العملاء</h2>
            <div className="analytics-funnel">
              {(funnel.data?.funnel ?? []).map((step) => (
                <div key={step.stage} className="analytics-funnel-step">
                  <span>{step.label}</span>
                  <strong>{step.count}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="card table-card">
            <h2 className="section-title-sm">أداء الحملات</h2>
            <div className="stats-grid">
              <article className="metric-card"><span>حملات</span><strong>{campaigns.data?.summary.campaigns ?? "…"}</strong></article>
              <article className="metric-card"><span>مستلمين</span><strong>{campaigns.data?.summary.recipients ?? "…"}</strong></article>
              <article className="metric-card"><span>تسليم</span><strong>{campaigns.data?.summary.delivery_rate != null ? `${campaigns.data.summary.delivery_rate}%` : "—"}</strong></article>
              <article className="metric-card"><span>قراءة</span><strong>{campaigns.data?.summary.read_rate != null ? `${campaigns.data.summary.read_rate}%` : "—"}</strong></article>
            </div>
            <table className="analytics-table">
              <thead><tr><th>الحملة</th><th>الحالة</th><th>مستلمين</th><th>تسليم %</th><th>قراءة %</th></tr></thead>
              <tbody>
                {(campaigns.data?.campaigns ?? []).map((item) => (
                  <tr key={item.id}>
                    <td><Link to={`/campaigns?id=${item.id}`}>{item.name}</Link></td>
                    <td>{item.status}</td>
                    <td>{item.recipients}</td>
                    <td>{item.delivery_rate != null ? `${item.delivery_rate}%` : "—"}</td>
                    <td>{item.read_rate != null ? `${item.read_rate}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "revenue" && (
        <>
          <section className="analytics-kpi-grid">
            <KpiCard label="Pipeline" value={revenue.data?.pipeline_value ?? "…"} href="/crm" />
            <KpiCard label="فوز (الفترة)" value={revenue.data?.won_value ?? "…"} change={revenue.data?.won_value_change_pct} />
            <KpiCard label="صفقات مفتوحة" value={revenue.data?.open_deals ?? "…"} />
            <KpiCard label="Forecast" value={revenue.data?.forecast ?? "…"} />
            <KpiCard label="سرعة الإغلاق (يوم)" value={revenue.data?.velocity_days ?? "—"} />
          </section>
          <section className="card analytics-chart-card">
            <h2 className="section-title-sm">CRM حسب المرحلة</h2>
            <div className="analytics-chart-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={revenueChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8edf2" />
                  <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="صفقات" fill="#5925dc" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}

      {tab === "insights" && (
        <section className="analytics-insights-grid">
          {(insights.data?.insights ?? []).map((item) => (
            <article key={item.code} className={`analytics-insight analytics-insight-${item.level}`}>
              <h3>{item.title}</h3>
              <p>{item.message}</p>
              {item.action_path && (
                <Link to={item.action_path} className="secondary-button">عرض التفاصيل</Link>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
