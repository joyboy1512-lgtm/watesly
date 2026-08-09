import { Link, useParams } from "react-router-dom";
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
  macBalanceClass
} from "../lib/macHelpers";
import { formatChannelType, channelTypeClass } from "../lib/channelHelpers";
import { formatAppTime } from "../lib/language";

const CHART_COLORS = ["#128c7e", "#25d366", "#075e54", "#34b7f1", "#f59e0b"];

type ChannelMacUsage = {
  channel_id: string;
  channel_name: string;
  channel_type: string;
  channel_status: string | null;
  cycle_month: string;
  billing_period: { start: string; end: string };
  mac: {
    channel_count: number;
    channel_included: number;
    channel_remaining: number;
    usage_percent: number;
    workspace_used: number;
    workspace_included: number;
    workspace_remaining: number;
    share_percent: number;
  };
  overage: {
    enabled: boolean;
    is_over: boolean;
    count: number;
    blocks: number;
    estimated_charge: number;
    price_per_100: number;
  };
  pricing: {
    plan_name: string;
    included_mac: number;
    over_mac_price_per_100: number;
  };
  policy: { limit_policy: string };
  breakdown_by_activity: Array<{ source: string; count: number }>;
  daily_trend: Array<{ date: string; count: number }>;
  campaign_messages_sent: number;
};

type MacContact = {
  id: string;
  channel_name: string | null;
  contact_display_name: string | null;
  contact_phone: string | null;
  trigger_source: string;
  first_activity_at: string;
};

function formatPeriodRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const fmt = new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt.format(s)} – ${fmt.format(e)}`;
}

function formatShortDay(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" }).format(date);
}

export default function ChannelMacDetailPage() {
  const { channelId = "" } = useParams();

  const usage = useQuery({
    queryKey: ["channel-mac-usage", channelId],
    enabled: Boolean(channelId),
    queryFn: async () =>
      (await api.get<ChannelMacUsage>(`/billing/mac/channels/${channelId}/usage`)).data
  });

  const contacts = useQuery({
    queryKey: ["channel-mac-contacts", channelId],
    enabled: Boolean(channelId) && usage.isSuccess,
    queryFn: async () =>
      (
        await api.get<MacContact[]>(`/billing/mac/channels/${channelId}/contacts`, {
          params: { limit: 12, offset: 0 },
          ...silentRequest
        })
      ).data
  });

  const u = usage.data;

  const channelChart = useMemo(() => {
    if (!u) return [];
    if (u.overage.is_over) {
      return [
        { name: "ضمن الحصة", value: u.mac.channel_included, color: CHART_COLORS[0] },
        { name: "تجاوز", value: u.overage.count, color: "#ef4444" }
      ].filter((item) => item.value > 0);
    }
    return [
      { name: "مستخدم", value: u.mac.channel_count, color: CHART_COLORS[0] },
      { name: "متبقٍ", value: u.mac.channel_remaining, color: "#bbf7d0" }
    ].filter((item) => item.value > 0);
  }, [u]);

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

  if (usage.isLoading) {
    return (
      <main className="page billing-page">
        <div className="page-loading">جاري تحميل MAC القناة…</div>
      </main>
    );
  }

  if (usage.isError || !u) {
    return (
      <main className="page billing-page">
        <header className="page-header billing-hero">
          <h1>MAC القناة</h1>
          <p>تعذر تحميل بيانات القناة أو ليس لديك صلاحية.</p>
        </header>
        <Link to="/channels" className="secondary-button">العودة للقنوات</Link>
      </main>
    );
  }

  return (
    <main className="page billing-page channel-mac-detail-page">
      <header className="page-header billing-hero">
        <div>
          <span className="billing-eyebrow">MAC · {formatChannelType(u.channel_type)}</span>
          <h1>{u.channel_name}</h1>
          <p>
            {u.mac.channel_count.toLocaleString("ar")} / {u.mac.channel_included.toLocaleString("ar")} MAC ·{" "}
            {formatMacBalance(u.mac.channel_count, u.mac.channel_included)} ·{" "}
            {formatPeriodRange(u.billing_period.start, u.billing_period.end)}
          </p>
        </div>
        <div className="channels-hero-actions">
          <Link to="/channels" className="secondary-button">القنوات</Link>
          <Link to="/billing" className="secondary-button">الفوترة</Link>
        </div>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand">
          <span>MAC مشمول</span>
          <strong>{u.mac.channel_included.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>الاستخدام</span>
          <strong>{u.mac.usage_percent}%</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>رصيد القناة</span>
          <strong className={macBalanceClass(u.overage.is_over, u.mac.channel_count, u.mac.channel_included)}>
            {formatMacBalance(u.mac.channel_count, u.mac.channel_included)}
          </strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>{u.overage.is_over ? "Over MAC" : "Over $/100"}</span>
          <strong className={macBalanceClass(u.overage.is_over, u.mac.channel_count, u.mac.channel_included)}>
            {u.overage.is_over
              ? `+$${u.overage.estimated_charge.toFixed(2)}`
              : `$${u.pricing.over_mac_price_per_100}/100`}
          </strong>
        </article>
      </section>

      <section className="card billing-plan-grid billing-channel-pricing-card">
        <div>
          <span>الخطة</span>
          <strong>{u.pricing.plan_name}</strong>
        </div>
        <div>
          <span>دورة الفوترة</span>
          <strong>{formatMacCycleMonth(u.cycle_month)}</strong>
        </div>
        <div>
          <span>MAC مشمول</span>
          <strong>{u.pricing.included_mac.toLocaleString("ar")}</strong>
        </div>
        <div>
          <span>Over MAC</span>
          <strong>${u.pricing.over_mac_price_per_100} / 100</strong>
        </div>
        <div>
          <span>تاريخ الدورة</span>
          <strong>{formatPeriodRange(u.billing_period.start, u.billing_period.end)}</strong>
        </div>
        <div>
          <span>سياسة الحد</span>
          <strong>{u.policy.limit_policy}</strong>
        </div>
      </section>

      {u.overage.is_over && (
        <section className="card admin-note-card">
          <p>
            تجاوزت هذه القناة {u.mac.channel_included.toLocaleString("ar")} MAC ·
            +{u.overage.count.toLocaleString("ar")} ({u.overage.blocks} × 100 @ ${u.overage.price_per_100}/100) ·
            تقدير ${u.overage.estimated_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="billing-per-channel-banner ready">
        <div>
          <strong>فوترة مستقلة لهذه القناة</strong>
          <small>
            MAC و Over MAC ودورة الاشتراك خاصة بهذه القناة.
            {u.campaign_messages_sent > 0
              ? ` ${u.campaign_messages_sent.toLocaleString("ar")} رسالة حملة (لا تُحسب MAC).`
              : " Broadcast لا يُحسب MAC."}
          </small>
        </div>
        <span className={channelTypeClass(u.channel_type)}>{formatChannelType(u.channel_type)}</span>
      </section>

      <section className="billing-charts-grid">
        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>رصيد MAC — هذه القناة</h2>
            <span>{u.mac.channel_count} / {u.mac.channel_included}</span>
          </div>
          <div className="billing-chart-wrap billing-chart-donut">
            {channelChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا MAC لهذه القناة بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={channelChart} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={88}>
                    {channelChart.map((entry) => (
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
            <h2>MAC يومي — هذه القناة</h2>
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
            <h2>مصادر النشاط — {u.channel_name}</h2>
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

      <section className="card billing-recent-card">
        <div className="billing-chart-head">
          <h2>جهات MAC — {u.channel_name}</h2>
          <span>مع مصدر التفعيل</span>
        </div>
        <ul className="billing-recent-list">
          {(contacts.data ?? []).length === 0 && (
            <li><p className="hint-text">لا جهات MAC مسجّلة لهذه القناة في هذه الدورة.</p></li>
          )}
          {(contacts.data ?? []).map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.contact_display_name ?? "عميل"}</strong>
                <small dir="ltr">{item.contact_phone ?? "—"}</small>
              </div>
              <div className="billing-recent-meta">
                <small>{formatMacTrigger(item.trigger_source)} · {formatAppTime(item.first_activity_at)}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
