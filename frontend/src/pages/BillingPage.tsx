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
import BillingProviderSettings from "../components/BillingProviderSettings";
import MacWorkspaceBalance from "../components/MacWorkspaceBalance";
import { hasNavPermission } from "../lib/navPermissions";
import {
  formatMacBalance,
  formatMacCycleMonth,
  formatMacTrigger,
  macBalanceClass
} from "../lib/macHelpers";
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
  campaign_messages_sent: number;
};

type Subscription = {
  plan_name: string;
  status: string;
  billing_cycle: string;
  starts_at: string;
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

type ChannelMacStat = {
  channel_id: string;
  channel_name: string;
  channel_type: string;
  channel_status: string | null;
  cycle_month: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  campaign_messages_sent: number;
  whatsapp_status: string | null;
  whatsapp_phone: string | null;
  subscription_starts_at: string | null;
  subscription_ends_at: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  over_mac_price_per_100: number;
  attributed_over_mac_count: number;
  estimated_channel_over_mac_charge: number;
};

type ChannelMacUsage = {
  channel_id: string;
  channel_name: string;
  mac: {
    channel_count: number;
    channel_included?: number;
    channel_remaining?: number;
    usage_percent?: number;
    workspace_used: number;
    share_percent: number;
  };
  breakdown_by_activity: Array<{ source: string; count: number }>;
  daily_trend: Array<{ date: string; count: number }>;
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
  const fmt = new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt.format(s)} – ${fmt.format(e)}`;
}

function formatPlanDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatBillingCycle(cycle: string): string {
  const labels: Record<string, string> = { monthly: "شهري", yearly: "سنوي", annual: "سنوي" };
  return labels[cycle] ?? cycle;
}

function formatPlanStatus(status: string): string {
  const labels: Record<string, string> = {
    active: "نشط",
    trialing: "تجربة",
    past_due: "متأخر",
    canceled: "ملغى"
  };
  return labels[status] ?? status;
}

export default function BillingPage() {
  const [selectedChannelId, setSelectedChannelId] = useState("");
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

  const channelUsage = useQuery({
    queryKey: ["billing-channel-usage", selectedChannelId],
    enabled: Boolean(selectedChannelId),
    queryFn: async () =>
      (await api.get<ChannelMacUsage>(`/billing/mac/channels/${selectedChannelId}/usage`)).data
  });

  const contacts = useQuery({
    queryKey: ["billing-mac-contacts", selectedChannelId],
    enabled: subscription.isSuccess,
    queryFn: async () =>
      (
        await api.get<MacContact[]>("/billing/mac/contacts", {
          params: {
            limit: 12,
            offset: 0,
            ...(selectedChannelId ? { channel_id: selectedChannelId } : {})
          },
          ...silentRequest
        })
      ).data
  });

  const sub = subscription.data;
  const u = usage.data;
  const channels = channelStats.data ?? [];
  const workspaceMac = u?.mac.used ?? sub?.mac_count ?? 0;
  const selectedChannel = channels.find((item) => item.channel_id === selectedChannelId);
  const channelView = channelUsage.data;

  const profile = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<{ permissions?: string[] }>("/auth/me")).data
  });

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

  const channelChart = useMemo(() => {
    const rows = (u?.breakdown_by_channel ?? []).map((item) => ({
      name: item.channel_name,
      count: item.count,
      highlight: selectedChannel?.channel_name === item.channel_name
    }));
    if (selectedChannelId && channelView) {
      return rows.filter((item) => item.name === channelView.channel_name);
    }
    return rows;
  }, [u?.breakdown_by_channel, selectedChannelId, channelView, selectedChannel?.channel_name]);

  const trendChart = useMemo(() => {
    const source = selectedChannelId && channelView ? channelView.daily_trend : (u?.daily_trend ?? []);
    return source.map((item) => ({ ...item, label: formatShortDay(item.date) }));
  }, [u?.daily_trend, selectedChannelId, channelView]);

  const triggerChart = useMemo(() => {
    const source =
      selectedChannelId && channelView
        ? channelView.breakdown_by_activity
        : (u?.breakdown_by_activity ?? []);
    return source.map((item) => ({
      source: formatMacTrigger(item.source),
      count: item.count
    }));
  }, [u?.breakdown_by_activity, selectedChannelId, channelView]);

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
          <span className="billing-eyebrow">{sub.plan_name} · {formatBillingCycle(sub.billing_cycle)}</span>
          <h1>الفوترة و MAC</h1>
          <p>
            {u
              ? `${u.mac.used.toLocaleString("ar")} / ${u.mac.included.toLocaleString("ar")} MAC · ${formatPeriodRange(u.billing_period.start, u.billing_period.end)}`
              : `${formatMacCycleMonth(sub.cycle_month)} · ${formatPlanStatus(sub.status)}`}
          </p>
        </div>
        <div className="channels-hero-actions">
          <Link to="/channels" className="secondary-button">القنوات</Link>
          <Link to="/pricing" className="secondary-button">التسعير</Link>
        </div>
      </header>

      <section className="billing-per-channel-banner ready card">
        <div>
          <strong>فوترة MAC مستقلة لكل قناة — نشطة الآن</strong>
          <small>
            كل قناة لها تاريخ اشتراك وحصة MAC وسعر Over MAC ودورة فوترة خاصة.
            نفس الجهة على قناتين = MACان. الإجمالي في الأعلى = مجموع كل القنوات.
          </small>
        </div>
        <span className="billing-per-channel-badge">لكل قناة</span>
      </section>

      <section className="card billing-plan-grid billing-plan-overview-card">
        <div>
          <span>الخطة</span>
          <strong>{sub.plan_name}</strong>
        </div>
        <div>
          <span>حالة الاشتراك</span>
          <strong>{formatPlanStatus(sub.status)}</strong>
        </div>
        <div>
          <span>بداية الاشتراك</span>
          <strong>{formatPlanDate(sub.starts_at)}</strong>
        </div>
        <div>
          <span>نهاية / تجديد</span>
          <strong>{formatPlanDate(sub.ends_at)}</strong>
        </div>
        <div>
          <span>MAC مشمول (مجمّع)</span>
          <strong>{sub.included_mac.toLocaleString("ar")}</strong>
        </div>
        <div>
          <span>Over MAC</span>
          <strong>${sub.over_mac_price_per_100} / 100</strong>
        </div>
        <div>
          <span>دورة MAC الحالية</span>
          <strong>{u ? formatPeriodRange(u.billing_period.start, u.billing_period.end) : formatMacCycleMonth(sub.cycle_month)}</strong>
        </div>
        <div>
          <span>{sub.is_over_mac ? "تقدير Over MAC" : "حالة الرصيد"}</span>
          <strong className={macBalanceClass(sub.is_over_mac, sub.mac_count, sub.included_mac)}>
            {sub.is_over_mac ? `$${sub.estimated_over_mac_charge.toFixed(2)}` : "ضمن الخطة"}
          </strong>
        </div>
      </section>

      {canManageBilling && <BillingProviderSettings />}

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

      <section className="card assignments-filter-card billing-channel-filter-card">
        <div className="assignments-filter-bar billing-filter-row">
          <div>
            <strong>فلترة حسب القناة</strong>
            <small>فلتر الرسوم والجهات على نفس الصفحة — أو افتح التفاصيل الكاملة</small>
          </div>
          <div className="billing-filter-controls">
            <select
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
            >
              <option value="">كل القنوات — نظرة عامة</option>
              {channels.map((item) => (
                <option key={item.channel_id} value={item.channel_id}>
                  {item.channel_name} · {item.mac_count.toLocaleString("ar")} MAC
                </option>
              ))}
            </select>
            {selectedChannelId && (
              <>
                <button type="button" className="secondary-button" onClick={() => setSelectedChannelId("")}>
                  إلغاء الفلتر
                </button>
                <Link to={`/channels/${selectedChannelId}/mac`} className="secondary-button">
                  صفحة التفاصيل
                </Link>
              </>
            )}
          </div>
        </div>
        {selectedChannel && channelView && (
          <div className="billing-channel-active-filter">
            <strong>{selectedChannel.channel_name}</strong>
            <span>
              {channelView.mac.channel_count.toLocaleString("ar")} / {selectedChannel.included_mac.toLocaleString("ar")} MAC
              {" "}· {formatMacBalance(channelView.mac.channel_count, selectedChannel.included_mac)}
            </span>
            <span className={channelTypeClass(selectedChannel.channel_type)}>{formatChannelType(selectedChannel.channel_type)}</span>
          </div>
        )}
      </section>

      {u?.overage.is_over && (
        <section className="card admin-note-card">
          <p>
            تجاوزت {u.mac.included.toLocaleString("ar")} MAC ·
            +{u.overage.count.toLocaleString("ar")} ({u.overage.blocks} × 100 @ ${u.overage.price_per_100}/100) ·
            تقدير ${u.overage.estimated_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="card admin-table-card billing-channels-table-card">
        <div className="admin-table-header">
          <div>
            <h2>MAC حسب القناة</h2>
            <small>فوترة مستقلة لكل قناة — MAC و Over MAC ودورة اشتراك منفصلة</small>
          </div>
        </div>
        <div className="billing-table-toolbar">
          <input
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            placeholder="بحث باسم القناة أو النوع أو رقم WhatsApp"
          />
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table">
            <thead>
              <tr>
                <th>القناة</th>
                <th>MAC مستخدم</th>
                <th>MAC مشمول / متبقٍ</th>
                <th>بداية الاشتراك</th>
                <th>نهاية الاشتراك</th>
                <th>دورة MAC</th>
                <th>سعر Over/100</th>
                <th>إجمالي Over MAC</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {channelStats.isLoading && (
                <tr><td colSpan={9} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!channelStats.isLoading && filteredChannels.length === 0 && (
                <tr><td colSpan={9} className="admin-table-empty">لا قنوات مطابقة.</td></tr>
              )}
              {filteredChannels.map((item) => {
                const usagePct = item.included_mac > 0
                  ? Math.round((item.mac_count / item.included_mac) * 100)
                  : 0;
                const isSelected = item.channel_id === selectedChannelId;
                const periodLabel =
                  item.billing_period_start && item.billing_period_end
                    ? formatPeriodRange(item.billing_period_start, item.billing_period_end)
                    : formatMacCycleMonth(item.cycle_month);
                return (
                  <tr key={item.channel_id} className={isSelected ? "billing-row-selected" : undefined}>
                    <td>
                      <div className="admin-cell-main">
                        <strong>{item.channel_name}</strong>
                        <small>
                          <span className={channelTypeClass(item.channel_type)}>{formatChannelType(item.channel_type)}</span>
                          {item.whatsapp_phone ? ` · ${item.whatsapp_phone}` : ""}
                        </small>
                      </div>
                    </td>
                    <td>
                      <strong>{item.mac_count.toLocaleString("ar")}</strong>
                      {item.is_over_mac && (
                        <small className="billing-over-charge">+{item.over_mac_count.toLocaleString("ar")} Over</small>
                      )}
                    </td>
                    <td>
                      <strong>{item.included_mac.toLocaleString("ar")}</strong>
                      <small>{item.mac_remaining.toLocaleString("ar")} متبقٍ · {usagePct}%</small>
                    </td>
                    <td>{item.subscription_starts_at ? formatPlanDate(item.subscription_starts_at) : "—"}</td>
                    <td>{item.subscription_ends_at ? formatPlanDate(item.subscription_ends_at) : "—"}</td>
                    <td>{periodLabel}</td>
                    <td>${item.over_mac_price_per_100.toFixed(2)}</td>
                    <td>
                      <strong className={item.estimated_channel_over_mac_charge > 0 ? "billing-over-charge" : ""}>
                        {item.estimated_channel_over_mac_charge > 0
                          ? `$${item.estimated_channel_over_mac_charge.toFixed(2)}`
                          : "—"}
                      </strong>
                      {item.attributed_over_mac_count > 0 && (
                        <small>+{item.attributed_over_mac_count.toLocaleString("ar")} MAC</small>
                      )}
                    </td>
                    <td>
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setSelectedChannelId(item.channel_id)}
                        >
                          فلتر
                        </button>
                        <Link to={`/channels/${item.channel_id}/mac`} className="secondary-button">
                          التفاصيل
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="billing-charts-grid">
        <article className="card billing-chart-card">
          <div className="billing-chart-head">
            <h2>{selectedChannelId ? "رصيد القناة" : "MAC المجمّع (كل القنوات)"}</h2>
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
            <span>{selectedChannel ? selectedChannel.channel_name : "تراكم خلال الدورة"}</span>
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
            <h2>MAC حسب القناة</h2>
            <small>MAC مستقل لكل قناة — نفس الجهة على قناتين = MACان</small>
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
                  <Bar dataKey="count" name="MAC" radius={[6, 6, 0, 0]}>
                    {channelChart.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.highlight ? CHART_COLORS[0] : CHART_COLORS[1]}
                        opacity={selectedChannelId && !entry.highlight ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="card billing-chart-card billing-chart-wide">
          <div className="billing-chart-head">
            <h2>مصادر النشاط</h2>
            <span>{selectedChannel ? selectedChannel.channel_name : "Incoming / Outgoing / AI"}</span>
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
        <div><span>رصيد MAC</span><strong>{formatMacBalance(workspaceMac, sub.included_mac)}</strong></div>
        <div><span>Over MAC</span><strong>${sub.over_mac_price_per_100}/100</strong></div>
      </section>

      <section className="card billing-recent-card">
        <div className="billing-chart-head">
          <h2>آخر جهات MAC</h2>
          <span>{selectedChannel ? selectedChannel.channel_name : "كل القنوات"}</span>
        </div>
        <ul className="billing-recent-list">
          {(contacts.data ?? []).length === 0 && (
            <li><p className="hint-text billing-chart-empty">لا جهات MAC في هذا العرض.</p></li>
          )}
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
        <summary>سياسة MAC والتسعير</summary>
        <ul className="mac-policy-list">
          <li>MAC = Contact فريد تفاعل خلال دورة فوترة القناة (ليس عدد الرسائل).</li>
          <li>Broadcast/حملات جماعية لا تُحسب MAC.</li>
          <li>كل قناة لها دورة اشتراك، حصة MAC، وسعر Over MAC مستقل.</li>
          <li>نفس الجهة على قناتين مختلفتين في نفس الدورة = MACان.</li>
          <li>Over MAC: يُحسب لكل قناة على حدة (ceil لكل 100).</li>
        </ul>
      </details>
    </main>
  );
}
