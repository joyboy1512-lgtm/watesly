import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
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
import CreateMacBillingForm from "../components/CreateMacBillingForm";
import { hasNavPermission } from "../lib/navPermissions";
import { formatMacTrigger } from "../lib/macHelpers";
import { channelTypeClass, formatChannelType } from "../lib/channelHelpers";
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
};

type Subscription = {
  plan_name: string;
  status: string;
  billing_cycle: string;
  starts_at: string;
  ends_at: string;
  included_mac: number;
  over_mac_price_per_100: number;
  mac_count: number;
  mac_remaining: number;
  is_over_mac: boolean;
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

type ChannelMacStat = {
  channel_id: string;
  channel_name: string;
  channel_type: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  outbound_messages_sent: number;
  campaign_messages_sent: number;
  messaging_limit_tier: string | null;
  messaging_limit: number | null;
  quality_rating: string | null;
  health_synced_at: string | null;
  whatsapp_phone: string | null;
  subscription_starts_at: string | null;
  subscription_ends_at: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  over_mac_price_per_100: number;
  estimated_channel_over_mac_charge: number;
};

function formatMessagingTierLimit(tier: string | null, limit: number | null): string {
  if (limit != null) return `${limit.toLocaleString("ar")}/24س`;
  if (tier === "TIER_UNLIMITED") return "غير محدود";
  return "—";
}

function formatQualityBadge(rating: string | null): string | null {
  if (!rating) return null;
  const labels: Record<string, string> = {
    GREEN: "ممتاز",
    YELLOW: "متوسط",
    RED: "منخفض"
  };
  return labels[rating.toUpperCase()] ?? rating;
}

function formatShortDay(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" }).format(date);
}

function formatPeriodRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const fmt = new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt.format(s)} – ${fmt.format(e)}`;
}

function formatPlanDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatBillingCycle(cycle: string): string {
  const labels: Record<string, string> = { monthly: "شهري", yearly: "سنوي", trial: "تجربة" };
  return labels[cycle] ?? cycle;
}

export default function BillingPage() {
  const [channelSearch, setChannelSearch] = useState("");

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

  const channelStats = useQuery({
    queryKey: ["billing-mac-channels"],
    enabled: subscription.isSuccess,
    queryFn: async () => (await api.get<ChannelMacStat[]>("/billing/mac/channels")).data
  });

  const contacts = useQuery({
    queryKey: ["billing-mac-contacts"],
    enabled: subscription.isSuccess,
    queryFn: async () =>
      (
        await api.get<MacContact[]>("/billing/mac/contacts", {
          params: { limit: 8, offset: 0 },
          ...silentRequest
        })
      ).data
  });

  const profile = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<{ permissions?: string[] }>("/auth/me")).data
  });

  const sub = subscription.data;
  const u = usage.data;
  const channels = channelStats.data ?? [];
  const canManageBilling = hasNavPermission(profile.data?.permissions, "billing.manage");

  const denied =
    subscription.error &&
    typeof subscription.error === "object" &&
    "response" in subscription.error &&
    (subscription.error as { response?: { status?: number } }).response?.status === 403;

  const filteredChannels = useMemo(() => {
    const term = channelSearch.trim().toLowerCase();
    if (!term) return channels;
    return channels.filter((item) =>
      `${item.channel_name} ${item.channel_type} ${item.whatsapp_phone ?? ""}`.toLowerCase().includes(term)
    );
  }, [channels, channelSearch]);

  const macUsed = u?.mac.used ?? sub?.mac_count ?? 0;
  const macIncluded = u?.mac.included ?? sub?.included_mac ?? 0;
  const macRemaining = u?.mac.remaining ?? sub?.mac_remaining ?? 0;
  const isOver = u?.overage.is_over ?? sub?.is_over_mac ?? false;
  const overCharge = u?.overage.estimated_charge ?? sub?.estimated_over_mac_charge ?? 0;

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
    () => (u?.daily_trend ?? []).map((item) => ({ ...item, label: formatShortDay(item.date) })),
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
          <h1>الفوترة</h1>
          <p>ليست لديك صلاحية عرض الفوترة.</p>
        </header>
      </main>
    );
  }

  if (subscription.isError || !sub) {
    return (
      <main className="page billing-page">
        <header className="page-header billing-hero">
          <h1>الفوترة</h1>
          <p>لا يوجد اشتراك نشط حالياً.</p>
        </header>
      </main>
    );
  }

  const periodLabel = u
    ? formatPeriodRange(u.billing_period.start, u.billing_period.end)
    : `${formatPlanDate(sub.starts_at)} – ${formatPlanDate(sub.ends_at)}`;

  return (
    <main className="page billing-page billing-page-v2">
      <header className="billing-hero billing-hero-compact">
        <div className="billing-hero-main">
          <span className="billing-eyebrow">{sub.plan_name} · {formatBillingCycle(sub.billing_cycle)}</span>
          <h1>الفوترة و MAC</h1>
          <p className="billing-hero-sub">{periodLabel}</p>
        </div>
        <div className="channels-hero-actions">
          <Link to="/channels" className="secondary-button">القنوات</Link>
          <Link to="/pricing" className="secondary-button">التسعير</Link>
        </div>
      </header>

      <section className="billing-kpi-row">
        <article className="billing-kpi-card billing-kpi-card-brand">
          <span>MAC المجمّع</span>
          <strong>{macUsed.toLocaleString("ar")} / {macIncluded.toLocaleString("ar")}</strong>
          <small>{macRemaining.toLocaleString("ar")} متبقٍ</small>
        </article>
        <article className="billing-kpi-card billing-kpi-card-brand">
          <span>Over MAC</span>
          <strong className={isOver ? "billing-kpi-over" : ""}>
            {isOver ? `$${overCharge.toFixed(2)}` : "—"}
          </strong>
          <small>${sub.over_mac_price_per_100}/100</small>
        </article>
        <article className="billing-kpi-card billing-kpi-card-brand">
          <span>القنوات</span>
          <strong>{channels.length.toLocaleString("ar")}</strong>
          <small>فوترة مستقلة لكل قناة</small>
        </article>
        <article className="billing-kpi-card billing-kpi-card-brand">
          <span>سياسة الحد</span>
          <strong>{u?.policy.limit_policy ?? "soft"}</strong>
          <small>{isOver ? "تجاوز" : "ضمن الخطة"}</small>
        </article>
      </section>

      {canManageBilling && (
        <section className="card billing-create-mac-card">
          <div className="billing-section-head billing-section-head-brand">
            <h2>إنشاء MAC</h2>
          </div>
          <CreateMacBillingForm
            channels={channels.map((item) => ({
              channel_id: item.channel_id,
              channel_name: item.channel_name,
              subscription_starts_at: item.subscription_starts_at,
              subscription_ends_at: item.subscription_ends_at,
              included_mac: item.included_mac,
              over_mac_price_per_100: item.over_mac_price_per_100
            }))}
          />
        </section>
      )}

      <section className="card admin-table-card billing-channels-table-card">
        <div className="admin-table-header billing-table-title-brand">
          <div>
            <h2>فوترة القنوات</h2>
            <small>{channels.length.toLocaleString("ar")} قناة · MAC · رسائل Meta</small>
          </div>
        </div>
        <div className="billing-table-toolbar">
          <input
            className="billing-table-search"
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            placeholder="بحث بالقناة أو الرقم…"
          />
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table billing-channels-table">
            <thead className="billing-channels-thead-brand">
              <tr>
                <th>القناة</th>
                <th>MAC</th>
                <th>الرسائل</th>
                <th>رصيد Tier</th>
                <th>الفترة</th>
                <th>Over</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {channelStats.isLoading && (
                <tr><td colSpan={7} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {channelStats.isError && (
                <tr><td colSpan={7} className="admin-table-empty">تعذر تحميل القنوات.</td></tr>
              )}
              {!channelStats.isLoading && !channelStats.isError && channels.length === 0 && (
                <tr><td colSpan={7} className="admin-table-empty"><Link to="/channels">أضف قناة</Link></td></tr>
              )}
              {!channelStats.isLoading && !channelStats.isError && channels.length > 0 && filteredChannels.length === 0 && (
                <tr><td colSpan={7} className="admin-table-empty">لا نتائج.</td></tr>
              )}
              {filteredChannels.map((item) => {
                const period =
                  item.billing_period_start && item.billing_period_end
                    ? formatPeriodRange(item.billing_period_start, item.billing_period_end)
                    : `${formatPlanDate(item.subscription_starts_at)} – ${formatPlanDate(item.subscription_ends_at)}`;
                const qualityLabel = formatQualityBadge(item.quality_rating);
                const tierLimit = formatMessagingTierLimit(item.messaging_limit_tier, item.messaging_limit);
                return (
                  <tr key={item.channel_id}>
                    <td>
                      <div className="admin-cell-main">
                        <strong>{item.channel_name}</strong>
                        <small>
                          <span className={channelTypeClass(item.channel_type)}>{formatChannelType(item.channel_type)}</span>
                          {item.whatsapp_phone ? ` · ${item.whatsapp_phone}` : ""}
                          {qualityLabel ? ` · ${qualityLabel}` : ""}
                        </small>
                      </div>
                    </td>
                    <td>
                      <strong>{item.mac_count.toLocaleString("ar")}</strong>
                      <small> / {item.included_mac.toLocaleString("ar")}</small>
                      {item.is_over_mac && (
                        <small className="billing-over-charge"> +{item.over_mac_count.toLocaleString("ar")}</small>
                      )}
                    </td>
                    <td>
                      <strong>{item.outbound_messages_sent.toLocaleString("ar")}</strong>
                      {item.campaign_messages_sent > 0 && (
                        <small> · حملات {item.campaign_messages_sent.toLocaleString("ar")}</small>
                      )}
                    </td>
                    <td>
                      <strong>{tierLimit}</strong>
                      {item.messaging_limit_tier && (
                        <small> · {item.messaging_limit_tier.replace("TIER_", "")}</small>
                      )}
                    </td>
                    <td><small>{period}</small></td>
                    <td>
                      {item.estimated_channel_over_mac_charge > 0
                        ? `$${item.estimated_channel_over_mac_charge.toFixed(2)}`
                        : "—"}
                    </td>
                    <td>
                      <Link to={`/channels/${item.channel_id}/mac`} className="secondary-button billing-row-link">
                        التفاصيل
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details className="card billing-collapsible">
        <summary>التحليلات والرسوم</summary>
        <section className="billing-charts-grid billing-charts-compact">
          <article className="card billing-chart-card">
            <div className="billing-chart-head">
              <h2>الرصيد</h2>
              <span>{macUsed} / {macIncluded}</span>
            </div>
            <div className="billing-chart-wrap billing-chart-donut">
              {balanceChart.length === 0 ? (
                <p className="hint-text billing-chart-empty">لا MAC.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={balanceChart} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={72}>
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
            </div>
            <div className="billing-chart-wrap">
              {trendChart.length === 0 ? (
                <p className="hint-text billing-chart-empty">لا بيانات.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={trendChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                    <Area type="monotone" dataKey="count" stroke={CHART_COLORS[0]} fill="rgba(37,211,102,0.15)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>
          <article className="card billing-chart-card billing-chart-wide">
            <div className="billing-chart-head"><h2>حسب القناة</h2></div>
            <div className="billing-chart-wrap">
              {channelChart.length === 0 ? (
                <p className="hint-text billing-chart-empty">لا بيانات.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={channelChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                    <Bar dataKey="count" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>
          <article className="card billing-chart-card billing-chart-wide">
            <div className="billing-chart-head"><h2>مصادر النشاط</h2></div>
            <div className="billing-chart-wrap">
              {triggerChart.length === 0 ? (
                <p className="hint-text billing-chart-empty">لا بيانات.</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={triggerChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(7,94,84,0.08)" />
                    <XAxis dataKey="source" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value: number) => value.toLocaleString("ar")} />
                    <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>
        </section>
      </details>

      {(contacts.data ?? []).length > 0 && (
        <section className="card billing-recent-card billing-recent-compact">
          <div className="billing-chart-head">
            <h2>آخر جهات MAC</h2>
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
      )}

      <details className="card billing-policy-details">
        <summary>سياسة MAC</summary>
        <ul className="mac-policy-list">
          <li>MAC = جهة اتصال فريدة تفاعلت خلال دورة فوترة القناة.</li>
          <li>كل قناة: حصة MAC وOver MAC وتواريخ مستقلة.</li>
          <li>نفس الجهة على قناتين = MACان.</li>
          <li>الحملات الجماعية لا تُحسب MAC.</li>
        </ul>
      </details>
    </main>
  );
}
