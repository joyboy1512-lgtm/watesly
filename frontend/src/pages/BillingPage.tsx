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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api, silentRequest } from "../lib/api";
import { formatChannelType, formatChannelStatus, channelStatusClass } from "../lib/channelHelpers";
import {
  formatMacBalance,
  formatMacCycleMonth,
  formatMacTrigger,
  formatMacUsagePercent,
  macBalanceClass
} from "../lib/macHelpers";
import { formatAppTime } from "../lib/language";

const CHART_COLORS = ["#128c7e", "#25d366", "#075e54", "#34b7f1", "#f59e0b", "#ef4444"];

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

type MacChannel = {
  channel_id: string;
  channel_name: string;
  channel_type: string;
  channel_status: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  campaign_messages_sent: number;
  whatsapp_phone: string | null;
};

type MacInsights = {
  cycle_month: string;
  included_mac_per_channel: number;
  channel_count: number;
  trigger_breakdown: Array<{ source: string; count: number }>;
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

  const channels = useQuery({
    queryKey: ["billing-mac-channels"],
    enabled: subscription.isSuccess,
    queryFn: async () => (await api.get<MacChannel[]>("/billing/mac/channels")).data
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
  const channelRows = channels.data ?? [];
  const macPerChannel = sub?.included_mac ?? insights.data?.included_mac_per_channel ?? 0;

  const denied =
    subscription.error &&
    typeof subscription.error === "object" &&
    "response" in subscription.error &&
    (subscription.error as { response?: { status?: number } }).response?.status === 403;

  const channelStats = useMemo(() => {
    const overChannels = channelRows.filter((item) => item.is_over_mac).length;
    const totalUsed = channelRows.reduce((sum, item) => sum + item.mac_count, 0);
    const totalCapacity = macPerChannel * Math.max(channelRows.length, 1);
    return { overChannels, totalUsed, totalCapacity, count: channelRows.length };
  }, [channelRows, macPerChannel]);

  const channelChart = useMemo(
    () =>
      channelRows.map((item) => ({
        name: item.channel_name.length > 18 ? `${item.channel_name.slice(0, 16)}…` : item.channel_name,
        used: item.mac_count,
        remaining: item.mac_remaining,
        limit: item.included_mac
      })),
    [channelRows]
  );

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
          <span className="billing-eyebrow">MAC لكل قناة</span>
          <h1>الفوترة و MAC</h1>
          <p>
            كل قناة لها رصيد MAC مستقل ({macPerChannel.toLocaleString("ar")} MAC/قناة) ·
            دورة {formatMacCycleMonth(sub.cycle_month)} · {sub.plan_name}
          </p>
        </div>
        <Link to="/channels" className="secondary-button">إدارة القنوات</Link>
      </header>

      <section className="billing-per-channel-banner ready">
        <div>
          <strong>MAC يُحسب لكل قناة على حدة</strong>
          <small>
            رصيد {macPerChannel.toLocaleString("ar")} MAC شهرياً لكل قناة — الاستخدام والتجاوز يُقيَّمان لكل قناة بشكل منفصل.
          </small>
        </div>
        <span className="billing-per-channel-badge">{channelStats.count} قناة</span>
      </section>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand">
          <span>MAC لكل قناة</span>
          <strong>{macPerChannel.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>إجمالي المستخدم</span>
          <strong>{channelStats.totalUsed.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>قنوات تجاوزت الحد</span>
          <strong>{channelStats.overChannels}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>رسائل حملة</span>
          <strong>{(insights.data?.campaign_messages_sent ?? 0).toLocaleString("ar")}</strong>
        </article>
      </section>

      <section className="billing-channels-grid">
        {channels.isLoading && <p className="hint-text">جاري تحميل القنوات…</p>}
        {!channels.isLoading && channelRows.length === 0 && (
          <article className="card billing-channel-card billing-channel-empty">
            <p>لا توجد قنوات بعد. أنشئ قناة من صفحة القنوات لبدء تتبع MAC.</p>
            <Link to="/channels" className="secondary-button">إضافة قناة</Link>
          </article>
        )}
        {channelRows.map((channel) => {
          const usagePercent = formatMacUsagePercent(channel.mac_count, channel.included_mac);
          return (
            <article key={channel.channel_id} className="card billing-channel-card">
              <div className="billing-channel-head">
                <div>
                  <strong>{channel.channel_name}</strong>
                  <small>{formatChannelType(channel.channel_type)}</small>
                </div>
                <span className={channelStatusClass(channel.channel_status)}>
                  {formatChannelStatus(channel.channel_status)}
                </span>
              </div>
              <div className="billing-channel-mac">
                <div className="progress-row">
                  <span>{formatMacBalance(channel.mac_count, channel.included_mac)}</span>
                  <strong>{usagePercent}%</strong>
                </div>
                <div className="progress-track">
                  <div
                    style={{
                      width: `${Math.min(100, usagePercent)}%`,
                      background: channel.is_over_mac
                        ? "linear-gradient(90deg, #ef4444, #f97316)"
                        : undefined
                    }}
                  />
                </div>
                <div className="billing-channel-meta">
                  <span className={macBalanceClass(channel.is_over_mac, channel.mac_count, channel.included_mac)}>
                    {channel.is_over_mac
                      ? `تجاوز +${channel.over_mac_count.toLocaleString("ar")} MAC`
                      : `${channel.mac_remaining.toLocaleString("ar")} MAC متبقٍ`}
                  </span>
                  {channel.campaign_messages_sent > 0 && (
                    <small>{channel.campaign_messages_sent.toLocaleString("ar")} رسالة حملة</small>
                  )}
                </div>
              </div>
              {channel.whatsapp_phone && <small dir="ltr" className="billing-channel-phone">{channel.whatsapp_phone}</small>}
            </article>
          );
        })}
      </section>

      {channelChart.length > 0 && (
        <section className="card billing-chart-card billing-chart-wide">
          <div className="billing-chart-head">
            <h2>MAC حسب القناة</h2>
            <span>مقارنة الاستخدام مقابل رصيد كل قناة</span>
          </div>
          <div className="billing-chart-wrap">
            <ResponsiveContainer width="100%" height={Math.max(220, channelChart.length * 48)}>
              <BarChart data={channelChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                <Bar dataKey="used" name="MAC مستخدم" stackId="mac" fill={CHART_COLORS[0]} radius={[0, 0, 0, 0]} />
                <Bar dataKey="remaining" name="MAC متبقٍ" stackId="mac" fill="#bbf7d0" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <section className="billing-charts-grid">
        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>MAC يومي</h2>
            <span>تراكم العملاء النشطين — كل القنوات</span>
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

        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>مصادر MAC</h2>
            <span>كيف بدأ التفاعل</span>
          </div>
          <div className="billing-chart-wrap">
            {triggerChart.length === 0 ? (
              <p className="hint-text billing-chart-empty">لا مصادر MAC بعد.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
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
        <div><span>MAC/قناة</span><strong>{macPerChannel.toLocaleString("ar")}</strong></div>
        <div><span>ينتهي</span><strong>{formatAppTime(sub.ends_at)}</strong></div>
      </section>

      <section className="card billing-recent-card">
        <div className="billing-chart-head">
          <h2>آخر جهات MAC</h2>
          <span>عميل واحد = MAC واحد على القناة التي بدأ منها التفاعل</span>
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
                <span>{item.channel_name ?? "—"}</span>
                <small>{formatMacTrigger(item.trigger_source)} · {formatAppTime(item.first_activity_at)}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className="card billing-policy-details">
        <summary>سياسة MAC — لكل قناة</summary>
        <ul className="mac-policy-list">
          <li>كل قناة WhatsApp (أو قناة أخرى) لها رصيد <strong>{macPerChannel.toLocaleString("ar")} MAC</strong> شهرياً.</li>
          <li>MAC يُحسب على العملاء الذين تفاعلوا عبر <strong>تلك القناة</strong> في الشهر.</li>
          <li>الحملات الجماعية لا تُحسب MAC — تُفوتر برسائل الحملة فقط.</li>
          <li>تجاوز رصيد قناة = Over MAC لتلك القناة (${sub.over_mac_price_per_100}/100 MAC).</li>
        </ul>
      </details>
    </main>
  );
}
