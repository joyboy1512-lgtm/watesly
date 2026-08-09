import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api, silentRequest } from "../lib/api";
import {
  formatMacBalance,
  formatMacCycleMonth,
  formatMacTrigger,
  formatMacUsagePercent,
  macBalanceClass
} from "../lib/macHelpers";
import { formatAppTime } from "../lib/language";

const CHART_COLORS = ["#128c7e", "#25d366", "#075e54", "#34b7f1", "#f59e0b"];

type Subscription = {
  plan_name: string;
  plan_code: string;
  status: string;
  billing_cycle: string;
  ends_at: string;
  max_users: number;
  max_channels: number;
  included_mac: number;
  over_mac_price_per_100: number;
  cycle_month: string;
  mac_count: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  over_mac_blocks: number;
  estimated_over_mac_charge: number;
};

type MacInsights = {
  cycle_month: string;
  trigger_breakdown: Array<{ source: string; count: number }>;
  daily_trend: Array<{ date: string; count: number }>;
  campaign_messages_sent: number;
};

type MacContact = {
  id: string;
  contact_display_name: string | null;
  contact_phone: string | null;
  trigger_source: string;
  first_activity_at: string;
};

function formatShortDay(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" }).format(date);
}

export default function BillingPage() {
  const subscription = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => (await api.get<Subscription>("/billing/subscription")).data,
    retry: false
  });

  const insights = useQuery({
    queryKey: ["billing-mac-insights"],
    enabled: subscription.isSuccess,
    queryFn: async () => (await api.get<MacInsights>("/billing/mac/insights")).data
  });

  const contacts = useQuery({
    queryKey: ["billing-mac-contacts-recent"],
    enabled: subscription.isSuccess,
    queryFn: async () =>
      (
        await api.get<MacContact[]>("/billing/mac/contacts", {
          params: { limit: 8, offset: 0 },
          ...silentRequest
        })
      ).data
  });

  const sub = subscription.data;
  const denied =
    subscription.error &&
    typeof subscription.error === "object" &&
    "response" in subscription.error &&
    (subscription.error as { response?: { status?: number } }).response?.status === 403;

  const usagePercent = sub ? formatMacUsagePercent(sub.mac_count, sub.included_mac) : 0;

  const balanceChart = useMemo(() => {
    if (!sub) return [];
    if (sub.is_over_mac) {
      return [
        { name: "ضمن الخطة", value: sub.included_mac, color: CHART_COLORS[0] },
        { name: "تجاوز", value: sub.over_mac_count, color: "#ef4444" }
      ];
    }
    return [
      { name: "مستخدم", value: sub.mac_count, color: CHART_COLORS[0] },
      { name: "متبقٍ", value: sub.mac_remaining, color: "#bbf7d0" }
    ].filter((item) => item.value > 0);
  }, [sub]);

  const trendChart = useMemo(
    () =>
      (insights.data?.daily_trend ?? []).map((item) => ({
        ...item,
        label: formatShortDay(item.date)
      })),
    [insights.data?.daily_trend]
  );

  const triggerChart = useMemo(
    () =>
      (insights.data?.trigger_breakdown ?? []).map((item) => ({
        source: formatMacTrigger(item.source),
        count: item.count
      })),
    [insights.data?.trigger_breakdown]
  );

  if (subscription.isLoading) {
    return (
      <main className="page billing-page">
        <div className="page-loading">جاري تحميل الفوترة…</div>
      </main>
    );
  }

  if (denied) {
    return (
      <main className="page billing-page">
        <header className="page-header billing-hero">
          <h1>الفوترة و MAC</h1>
          <p>ليست لديك صلاحية عرض الفوترة. تواصل مع مالك الحساب.</p>
        </header>
      </main>
    );
  }

  if (subscription.isError || !sub) {
    return (
      <main className="page billing-page">
        <header className="page-header billing-hero">
          <h1>الفوترة و MAC</h1>
          <p>لا يوجد اشتراك نشط حالياً.</p>
        </header>
      </main>
    );
  }

  return (
    <main className="page billing-page">
      <header className="page-header billing-hero">
        <div>
          <span className="billing-eyebrow">الفوترة الشهرية</span>
          <h1>الفوترة و MAC</h1>
          <p>
            دورة {formatMacCycleMonth(sub.cycle_month)} · {sub.plan_name} ·{" "}
            {formatMacBalance(sub.mac_count, sub.included_mac)}
          </p>
        </div>
        <Link to="/channels" className="secondary-button">إدارة القنوات</Link>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand">
          <span>MAC المستخدم</span>
          <strong>{sub.mac_count.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>المتبقي</span>
          <strong>{sub.is_over_mac ? "0" : sub.mac_remaining.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>نسبة الاستخدام</span>
          <strong>{usagePercent}%</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>رسائل حملة</span>
          <strong>{(insights.data?.campaign_messages_sent ?? 0).toLocaleString("ar")}</strong>
        </article>
      </section>

      <section className="card billing-summary-card">
        <div className="billing-summary-head">
          <div>
            <strong>رصيد MAC — مساحة العمل</strong>
            <small>{sub.plan_name} · {sub.billing_cycle}</small>
          </div>
          <span className={macBalanceClass(sub.is_over_mac, sub.mac_count, sub.included_mac)}>
            {sub.is_over_mac
              ? `Over MAC +${sub.over_mac_count.toLocaleString("ar")} · $${sub.estimated_over_mac_charge.toFixed(0)}`
              : "ضمن الخطة"}
          </span>
        </div>
        <div className="progress-row">
          <span>{formatMacBalance(sub.mac_count, sub.included_mac)}</span>
          <strong>{usagePercent}%</strong>
        </div>
        <div className="progress-track">
          <div style={{ width: `${Math.min(100, usagePercent)}%` }} />
        </div>
      </section>

      {sub.is_over_mac && (
        <section className="card admin-note-card">
          <p>
            تجاوزت {sub.included_mac.toLocaleString("ar")} MAC المشمولة ·
            الزيادة {sub.over_mac_count.toLocaleString("ar")} ({sub.over_mac_blocks} × 100) ·
            ${sub.over_mac_price_per_100} لكل 100 MAC ·
            تقدير ${sub.estimated_over_mac_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="billing-charts-grid">
        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>توزيع الرصيد</h2>
            <span>MAC الشهر الحالي</span>
          </div>
          <div className="billing-chart-wrap billing-chart-donut">
            {balanceChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا استخدام MAC بعد في هذه الدورة.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={balanceChart}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {balanceChart.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="billing-chart-legend">
            {balanceChart.map((item) => (
              <span key={item.name}>
                <i style={{ background: item.color }} /> {item.name}: {item.value.toLocaleString("ar")}
              </span>
            ))}
          </div>
        </article>

        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>MAC يومي</h2>
            <span>تراكم العملاء النشطين</span>
          </div>
          <div className="billing-chart-wrap">
            {trendChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا بيانات يومية بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="MAC"
                    stroke={CHART_COLORS[0]}
                    fill="rgba(37,211,102,0.18)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="card billing-chart-card billing-chart-wide">
          <div className="billing-chart-head">
            <h2>مصادر MAC</h2>
            <span>كيف بدأ التفاعل مع العملاء</span>
          </div>
          <div className="billing-chart-wrap">
            {triggerChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا مصادر MAC مسجّلة بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={triggerChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                  <XAxis dataKey="source" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                  <Bar dataKey="count" name="MAC" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
      </section>

      <section className="billing-plan-strip card">
        <div><span>الموظفون</span><strong>{sub.max_users}</strong></div>
        <div><span>القنوات</span><strong>{sub.max_channels}</strong></div>
        <div><span>MAC مشمول</span><strong>{sub.included_mac.toLocaleString("ar")}</strong></div>
        <div><span>ينتهي الاشتراك</span><strong>{formatAppTime(sub.ends_at)}</strong></div>
      </section>

      <section className="card billing-recent-card">
        <div className="billing-chart-head">
          <h2>آخر جهات MAC</h2>
          <span>عميل واحد = MAC واحد في الشهر</span>
        </div>
        {contacts.isLoading && <p className="hint-text">جاري التحميل…</p>}
        {!contacts.isLoading && (contacts.data ?? []).length === 0 && (
          <p className="hint-text billing-chart-empty">لا جهات MAC في هذه الدورة بعد.</p>
        )}
        <ul className="billing-recent-list">
          {(contacts.data ?? []).map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.contact_display_name ?? "عميل"}</strong>
                <small dir="ltr">{item.contact_phone ?? "—"}</small>
              </div>
              <div className="billing-recent-meta">
                <span>{formatMacTrigger(item.trigger_source)}</span>
                <small>{formatAppTime(item.first_activity_at)}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className="card billing-policy-details">
        <summary>سياسة MAC في Watesly</summary>
        <ul className="mac-policy-list">
          <li>كل رقم يتفاعل مع شركتك خلال الشهر = <strong>MAC واحد</strong>.</li>
          <li>يُحتسب عند رسالة واردة أو رد من Inbox/الموظف/الذكاء الاصطناعي.</li>
          <li>الحملات الجماعية <strong>لا تُحسب MAC</strong> — تُفوتر برسائل الحملة فقط.</li>
        </ul>
      </details>
    </main>
  );
}
