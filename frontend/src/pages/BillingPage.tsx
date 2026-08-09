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
import MacWorkspaceBalance from "../components/MacWorkspaceBalance";
import {
  formatMacCycleMonth,
  formatMacTrigger
} from "../lib/macHelpers";
import { formatAppTime } from "../lib/language";

const CHART_COLORS = ["#128c7e", "#25d366", "#075e54", "#34b7f1", "#f59e0b"];

type BillingUsage = {
  billing_period: { start: string; end: string };
  mac: { used: number; included: number; remaining: number; percentage: number };
  overage: {
    enabled: boolean;
    is_over: boolean;
    count: number;
    blocks: number;
    estimated_charge: number;
    price_per_100: number;
  };
  policy: { limit_policy: string };
  breakdown_by_channel: Array<{ channel_name: string; channel_type: string; count: number }>;
  breakdown_by_activity: Array<{ source: string; count: number }>;
  daily_trend: Array<{ date: string; count: number }>;
  campaign_messages_sent: number;
};

type Subscription = {
  plan_name: string;
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

type MacContact = {
  id: string;
  channel_name: string | null;
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

function formatPeriodRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const fmt = new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" });
  return `${fmt.format(s)} – ${fmt.format(e)}`;
}

export default function BillingPage() {
  const subscription = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => (await api.get<Subscription>("/billing/subscription")).data,
    retry: false
  });

  const usage = useQuery({
    queryKey: ["billing-usage"],
    enabled: subscription.isSuccess,
    queryFn: async () => (await api.get<BillingUsage>("/billing/usage")).data
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
  const u = usage.data;

  const denied =
    subscription.error &&
    typeof subscription.error === "object" &&
    "response" in subscription.error &&
    (subscription.error as { response?: { status?: number } }).response?.status === 403;

  const balanceChart = useMemo(() => {
    if (!u) return [];
    if (u.overage.is_over) {
      return [
        { name: "ضمن الخطة", value: u.mac.included, color: CHART_COLORS[0] },
        { name: "تجاوز", value: u.overage.count, color: "#ef4444" }
      ];
    }
    return [
      { name: "مستخدم", value: u.mac.used, color: CHART_COLORS[0] },
      { name: "متبقٍ", value: u.mac.remaining, color: "#bbf7d0" }
    ].filter((item) => item.value > 0);
  }, [u]);

  const channelChart = useMemo(
    () =>
      (u?.breakdown_by_channel ?? []).map((item) => ({
        name: item.channel_name,
        count: item.count
      })),
    [u?.breakdown_by_channel]
  );

  const trendChart = useMemo(
    () =>
      (u?.daily_trend ?? []).map((item) => ({
        ...item,
        label: formatShortDay(item.date)
      })),
    [u?.daily_trend]
  );

  const triggerChart = useMemo(
    () =>
      (u?.breakdown_by_activity ?? []).map((item) => ({
        source: formatMacTrigger(item.source),
        count: item.count
      })),
    [u?.breakdown_by_activity]
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
          <p>ليست لديك صلاحية عرض الفوترة.</p>
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
          <span className="billing-eyebrow">Monthly Active Contacts</span>
          <h1>الفوترة و MAC</h1>
          <p>
            {u
              ? `${u.mac.used.toLocaleString("ar")} / ${u.mac.included.toLocaleString("ar")} MAC · ${formatPeriodRange(u.billing_period.start, u.billing_period.end)}`
              : `${sub.plan_name} · ${formatMacCycleMonth(sub.cycle_month)}`}
          </p>
        </div>
        <Link to="/channels" className="secondary-button">القنوات</Link>
      </header>

      {u && (
        <MacWorkspaceBalance
          showPolicy={false}
          billingPeriod={{ start: u.billing_period.start, end: u.billing_period.end }}
          summary={{
            cycle_month: sub.cycle_month,
            mac_count: u.mac.used,
            included_mac: u.mac.included,
            mac_remaining: u.mac.remaining,
            is_over_mac: u.overage.is_over,
            over_mac_count: u.overage.count,
            estimated_over_mac_charge: u.overage.estimated_charge,
            over_mac_price_per_100: u.overage.price_per_100,
            plan_name: sub.plan_name
          }}
        />
      )}

      <section className="billing-per-channel-banner ready">
        <div>
          <strong>MAC = جهات اتصال فريدة تفاعلت خلال دورة الفوترة</strong>
          <small>
            ليس عدد الرسائل. Broadcast لا يُحسب. نفس العميل = MAC واحد في الدورة (حتى عبر قنوات متعددة).
          </small>
        </div>
        <span className="billing-per-channel-badge">{u?.mac.percentage ?? 0}%</span>
      </section>

      {u?.overage.is_over && (
        <section className="card admin-note-card">
          <p>
            تجاوزت {u.mac.included.toLocaleString("ar")} MAC ·
            +{u.overage.count.toLocaleString("ar")} ({u.overage.blocks} × 100) ·
            تقدير ${u.overage.estimated_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="billing-charts-grid">
        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>Monthly Active Contacts</h2>
            <span>{u?.mac.used ?? 0} / {u?.mac.included ?? sub.included_mac}</span>
          </div>
          <div className="billing-chart-wrap billing-chart-donut">
            {balanceChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا MAC بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={balanceChart} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={88}>
                    {balanceChart.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>MAC يومي</h2>
            <span>تراكم خلال الدورة</span>
          </div>
          <div className="billing-chart-wrap">
            {trendChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا بيانات بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                  <Area type="monotone" dataKey="count" name="MAC" stroke={CHART_COLORS[0]} fill="rgba(37,211,102,0.18)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="card billing-chart-card billing-chart-wide">
          <div className="billing-chart-head">
            <h2>MAC حسب القناة (إسناد أول تفاعل)</h2>
            <small>لا يُضاعَف — إجمالي MAC = جهات فريدة</small>
          </div>
          <div className="billing-chart-wrap">
            {channelChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا بيانات قنوات.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={channelChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                  <Bar dataKey="count" name="MAC" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="card billing-chart-card billing-chart-wide">
          <div className="billing-chart-head">
            <h2>مصادر النشاط</h2>
            <span>Incoming / Outgoing / AI</span>
          </div>
          <div className="billing-chart-wrap">
            {triggerChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا مصادر بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={triggerChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                  <XAxis dataKey="source" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                  <Bar dataKey="count" name="MAC" radius={[6, 6, 0, 0]}>
                    {triggerChart.map((_, index) => (
                      <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
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
        <div><span>سياسة الحد</span><strong>{u?.policy.limit_policy ?? "soft"}</strong></div>
      </section>

      <section className="card billing-recent-card">
        <div className="billing-chart-head">
          <h2>آخر جهات MAC</h2>
          <span>مع القناة ومصدر التفعيل</span>
        </div>
        <ul className="billing-recent-list">
          {(contacts.data ?? []).map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.contact_display_name ?? "عميل"}</strong>
                <small dir="ltr">{item.contact_phone ?? "—"}</small>
              </div>
              <div className="billing-recent-meta">
                <span>{item.channel_name ?? "—"}</span>
                <small>{formatMacTrigger(item.trigger_source)} · {formatAppTime(item.first_activity_at)}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className="card billing-policy-details">
        <summary>سياسة MAC</summary>
        <ul className="mac-policy-list">
          <li>MAC = Contact فريد تفاعل خلال دورة الفوترة (ليس عدد الرسائل).</li>
          <li>Broadcast/حملات جماعية لا تُحسب MAC.</li>
          <li>Contacts المحفوظون لا يُحذفون — MAC metric للاستخدام فقط.</li>
          <li>Over MAC: ${sub.over_mac_price_per_100} لكل 100 MAC (ceil).</li>
        </ul>
      </details>
    </main>
  );
}
