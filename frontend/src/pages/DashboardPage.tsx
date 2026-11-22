import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api, silentRequest } from "../lib/api";
import Icon from "../components/Icon";
import MacWorkspaceBalance from "../components/MacWorkspaceBalance";
import { formatMacUsagePercent } from "../lib/macHelpers";
import { useCurrentUser, useHasPermission } from "../hooks/usePermissions";

type WaitingConversation = {
  id: string;
  contact_name: string | null;
  contact_address: string;
  last_message_text: string | null;
  last_message_at: string | null;
  waiting_minutes: number | null;
};

type LatestCampaign = {
  id: string;
  name: string;
  status: string;
  completed_at: string | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

type DashboardAlert = {
  level: string;
  code: string;
  message: string;
  action_path: string | null;
};

type DashboardSummary = {
  open_conversations: number;
  pending_conversations: number;
  closed_conversations: number;
  total_conversations: number;
  total_contacts: number;
  active_users: number;
  total_channels: number;
  sent_messages_today: number;
  received_messages_today: number;
  csat_average: number | null;
  csat_total_ratings: number;
  csat_promoters_pct: number | null;
  first_response_avg_minutes: number | null;
  waiting_conversations: WaitingConversation[];
  latest_campaign: LatestCampaign | null;
  alerts: DashboardAlert[];
};

const quickActions = [
  { to: "/inbox", label: "صندوق الوارد", hint: "رد على المحادثات", icon: "inbox" as const },
  { to: "/campaigns?action=create", label: "حملة WhatsApp", hint: "إرسال جماعي بقالب", icon: "campaign" as const },
  { to: "/catalog/new", label: "منتج أو خدمة", hint: "إضافة للكتالوج", icon: "template" as const },
  { to: "/analytics", label: "التحليلات", hint: "أداء الفريق وCSAT", icon: "dashboard" as const }
];

const campaignStatusLabels: Record<string, string> = {
  draft: "مسودة",
  scheduled: "مجدولة",
  running: "جاري الإرسال",
  completed: "مكتملة",
  completed_with_errors: "مكتملة بأخطاء",
  paused: "متوقفة",
  cancelled: "ملغاة",
  failed: "فشلت"
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Email",
  sms: "SMS",
  web_chat: "Web Chat",
  telegram: "Telegram",
  messenger: "Messenger"
};

function formatWaiting(minutes: number | null) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(value));
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const profile = useCurrentUser();
  const canViewReports = useHasPermission("reports.view");
  const canViewBilling = useHasPermission("billing.view");

  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    enabled: canViewReports,
    queryFn: async () => (await api.get<DashboardSummary>("/dashboard/summary")).data,
    refetchInterval: canViewReports ? 60_000 : false
  });

  const supervisor = useQuery({
    queryKey: ["supervisor-summary"],
    enabled: canViewReports,
    queryFn: async () =>
      (
        await api.get<{
          waiting_conversations: number;
          snoozed_conversations: number;
          sla_breached_conversations: number;
          unresolved_over_1h?: number;
          by_channel?: Array<{ channel_type: string; open_conversations: number }>;
          agents?: Array<{ membership_id: string; full_name: string; open_conversations: number }>;
        }>("/inbox-tools/supervisor-summary", silentRequest)
      ).data,
    refetchInterval: canViewReports ? 60_000 : false
  });

  const subscription = useQuery({
    queryKey: ["subscription"],
    enabled: canViewBilling,
    queryFn: async () => {
      try {
        return (await api.get("/billing/subscription", silentRequest)).data;
      } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
          const status = (error as { response?: { status?: number } }).response?.status;
          if (status === 404 || status === 403) return null;
        }
        throw error;
      }
    }
  });

  const data = summary.data;

  const stats = [
    {
      label: "المحادثات المفتوحة",
      value: String(data?.open_conversations ?? 0),
      change: `${data?.pending_conversations ?? 0} قيد الانتظار`,
      icon: "inbox" as const,
      to: "/inbox",
      tone: "solid" as const
    },
    {
      label: "الرسائل اليوم",
      value: String((data?.sent_messages_today ?? 0) + (data?.received_messages_today ?? 0)),
      change: `${data?.received_messages_today ?? 0} واردة · ${data?.sent_messages_today ?? 0} صادرة`,
      icon: "dashboard" as const,
      to: "/inbox",
      tone: "soft" as const
    },
    {
      label: "CSAT",
      value: data?.csat_average != null ? `${data.csat_average}` : "—",
      change: data?.csat_total_ratings ? `${data.csat_total_ratings} تقييم · ${data.csat_promoters_pct ?? 0}% ≥4` : "لا توجد تقييمات بعد",
      icon: "dashboard" as const,
      to: "/analytics",
      tone: "soft" as const
    },
    {
      label: "متوسط أول رد",
      value: data?.first_response_avg_minutes != null ? `${data.first_response_avg_minutes} د` : "—",
      change: "آخر 7 أيام",
      icon: "team" as const,
      to: "/analytics",
      tone: "outline" as const
    }
  ] as const;

  const campaign = data?.latest_campaign;
  const firstName = profile.data?.full_name?.split(" ")[0] ?? "فريق Watesly";

  return (
    <main className="page page-dashboard">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-hero-eyebrow">{t("eyebrow.wateslyWorkspace")}</span>
          <h1>مرحباً، {firstName}</h1>
          <p>ملخص أداء الفريق والقنوات اليوم — ركّز على ما يحتاج رداً الآن.</p>
        </div>
        <div className="dashboard-hero-actions">
          <Link to="/inbox" className="dashboard-hero-btn dashboard-hero-btn-primary">
            فتح صندوق الوارد
          </Link>
          <Link to="/campaigns?action=create" className="dashboard-hero-btn dashboard-hero-btn-ghost">
            إنشاء حملة
          </Link>
        </div>
      </section>

      {subscription.data?.included_mac != null && (
        <MacWorkspaceBalance
          showPolicy={false}
          summary={{
            cycle_month: subscription.data.cycle_month,
            mac_count: subscription.data.mac_count ?? 0,
            included_mac: subscription.data.included_mac,
            mac_remaining: subscription.data.mac_remaining ?? 0,
            is_over_mac: Boolean(subscription.data.is_over_mac),
            over_mac_count: subscription.data.over_mac_count ?? 0,
            estimated_over_mac_charge: subscription.data.estimated_over_mac_charge ?? 0,
            plan_name: subscription.data.plan_name
          }}
        />
      )}

      {(data?.alerts ?? []).length > 0 && (
        <section className="dashboard-alerts">
          {(data?.alerts ?? []).map((alert) => (
            alert.action_path ? (
              <Link
                key={alert.code}
                to={alert.action_path}
                className={`dashboard-alert dashboard-alert-${alert.level}`}
              >
                {alert.message}
              </Link>
            ) : (
              <div key={alert.code} className={`dashboard-alert dashboard-alert-${alert.level}`}>
                {alert.message}
              </div>
            )
          ))}
        </section>
      )}

      <section className="dashboard-quick-actions" aria-label="اختصارات سريعة">
        {quickActions.map((item) => (
          <Link key={item.to} to={item.to} className="dashboard-quick-card">
            <span className="dashboard-quick-icon"><Icon name={item.icon} /></span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </div>
          </Link>
        ))}
      </section>

      <section className="dashboard-kpi-grid" aria-label="مؤشرات الأداء">
        {stats.map((item) => (
          <Link
            to={item.to}
            className={`dashboard-kpi-card dashboard-kpi-${item.tone}`}
            key={item.label}
          >
            <div className="dashboard-kpi-top">
              <span className="dashboard-kpi-icon"><Icon name={item.icon} /></span>
              <span className="dashboard-kpi-label">{item.label}</span>
            </div>
            <strong className="dashboard-kpi-value">{summary.isLoading ? "…" : item.value}</strong>
            <small className="dashboard-kpi-meta">{item.change}</small>
          </Link>
        ))}
      </section>

      <section className="dashboard-panel dashboard-panel-green" aria-label="غرفة قيادة المشرف">
        <div className="dashboard-panel-head">
          <div>
            <h2>غرفة قيادة المشرف</h2>
            <p>انتظار · SLA · حمل الموظفين · القنوات</p>
          </div>
          <Link to="/assignments" className="dashboard-panel-link">التعيينات</Link>
        </div>
        <div className="dashboard-supervisor-grid">
          <article className="dashboard-supervisor-tile">
            <span>تنتظر رداً</span>
            <strong>{supervisor.isLoading ? "…" : supervisor.data?.waiting_conversations ?? 0}</strong>
          </article>
          <article className="dashboard-supervisor-tile">
            <span>مؤجلة</span>
            <strong>{supervisor.isLoading ? "…" : supervisor.data?.snoozed_conversations ?? 0}</strong>
          </article>
          <article className="dashboard-supervisor-tile dashboard-supervisor-alert">
            <span>تجاوز SLA</span>
            <strong>{supervisor.isLoading ? "…" : supervisor.data?.sla_breached_conversations ?? 0}</strong>
          </article>
          <article className="dashboard-supervisor-tile dashboard-supervisor-alert">
            <span>بدون حل +1 ساعة</span>
            <strong>{supervisor.isLoading ? "…" : supervisor.data?.unresolved_over_1h ?? 0}</strong>
          </article>
        </div>
        <div className="dashboard-supervisor-columns">
          <div>
            <h3>حمل الموظفين</h3>
            {!(supervisor.data?.agents ?? []).length && <p className="hint-text">لا توجد محادثات معيّنة حالياً.</p>}
            <ul className="dashboard-rank-list">
              {(supervisor.data?.agents ?? []).map((agent) => (
                <li key={agent.membership_id}>
                  <strong>{agent.full_name}</strong>
                  <span>{agent.open_conversations} مفتوحة</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>القنوات النشطة</h3>
            {!(supervisor.data?.by_channel ?? []).length && <p className="hint-text">لا توجد محادثات مفتوحة.</p>}
            <ul className="dashboard-rank-list">
              {(supervisor.data?.by_channel ?? []).map((row) => (
                <li key={row.channel_type}>
                  <strong>{CHANNEL_TYPE_LABELS[row.channel_type] ?? row.channel_type}</strong>
                  <span>{row.open_conversations}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="dashboard-split">
        <article className="dashboard-panel dashboard-panel-green">
          <div className="dashboard-panel-head">
            <div>
              <h2>تنتظر ردّك</h2>
              <p>آخر محادثات برسالة واردة من العميل</p>
            </div>
            <Link to="/inbox" className="dashboard-panel-link">صندوق الوارد</Link>
          </div>
          <div className="dashboard-waiting-list">
            {summary.isLoading && <p className="hint-text">جاري التحميل…</p>}
            {!summary.isLoading && !(data?.waiting_conversations ?? []).length && (
              <p className="hint-text">لا توجد محادثات تنتظر رداً حالياً.</p>
            )}
            {(data?.waiting_conversations ?? []).map((item) => (
              <Link
                key={item.id}
                to={`/inbox?conversation=${item.id}`}
                className="dashboard-waiting-row"
              >
                <div className="avatar avatar-soft">
                  {(item.contact_name || item.contact_address).slice(0, 2).toUpperCase()}
                </div>
                <div className="dashboard-waiting-copy">
                  <strong>{item.contact_name || item.contact_address}</strong>
                  <span>{item.last_message_text || "رسالة غير نصية"}</span>
                </div>
                <div className="dashboard-waiting-meta">
                  <time>{formatTime(item.last_message_at)}</time>
                  <small>{formatWaiting(item.waiting_minutes)}</small>
                </div>
              </Link>
            ))}
          </div>
        </article>

        <article className="dashboard-panel dashboard-panel-green">
          <div className="dashboard-panel-head">
            <div>
              <h2>آخر حملة</h2>
              <p>حالة الإرسال والتسليم</p>
            </div>
            {campaign && (
              <Link to="/campaigns" className="dashboard-panel-link">كل الحملات</Link>
            )}
          </div>
          {!campaign && !summary.isLoading && (
            <div className="dashboard-empty-state">
              <p className="hint-text">لم تُنشأ حملات بعد.</p>
              <Link to="/campaigns?action=create" className="whatsapp-button">إنشاء أول حملة</Link>
            </div>
          )}
          {campaign && (
            <div className="dashboard-campaign-card">
              <div className="dashboard-campaign-head">
                <strong>{campaign.name}</strong>
                <span className={`campaign-status-badge status-${campaign.status}`}>
                  {campaignStatusLabels[campaign.status] ?? campaign.status}
                </span>
              </div>
              <div className="dashboard-campaign-stats">
                <div><strong>{campaign.total}</strong><span>إجمالي</span></div>
                <div><strong>{campaign.sent}</strong><span>مُرسل</span></div>
                <div><strong>{campaign.delivered}</strong><span>مُسلّم</span></div>
                <div><strong>{campaign.read}</strong><span>مقروء</span></div>
                <div><strong>{campaign.failed}</strong><span>فشل</span></div>
              </div>
              {campaign.completed_at && (
                <p className="hint-text">انتهت: {formatTime(campaign.completed_at)}</p>
              )}
            </div>
          )}
        </article>
      </section>

      <section className="dashboard-split dashboard-split-narrow">
        <article className="dashboard-panel dashboard-panel-green">
          <div className="dashboard-panel-head">
            <div>
              <h2>ملخص المحادثات</h2>
              <p>الحالة الحالية</p>
            </div>
          </div>
          <div className="dashboard-summary-list">
            <Link to="/inbox" className="dashboard-summary-item">
              <span>مفتوحة</span>
              <strong>{data?.open_conversations ?? 0}</strong>
            </Link>
            <Link to="/inbox" className="dashboard-summary-item">
              <span>قيد الانتظار</span>
              <strong>{data?.pending_conversations ?? 0}</strong>
            </Link>
            <div className="dashboard-summary-item">
              <span>مغلقة</span>
              <strong>{data?.closed_conversations ?? 0}</strong>
            </div>
            <Link to="/contacts" className="dashboard-summary-item">
              <span>جهات الاتصال</span>
              <strong>{data?.total_contacts ?? 0}</strong>
            </Link>
          </div>
        </article>

        <article className="dashboard-panel dashboard-panel-green">
          <div className="dashboard-panel-head">
            <div>
              <h2>الاشتراك</h2>
              <p>استخدام الخطة الحالية</p>
            </div>
            <Link to="/billing" className="dashboard-panel-link">الفوترة</Link>
          </div>
          <div className="dashboard-plan-card">
            <span className="dashboard-plan-badge">{subscription.data?.plan_name ?? "Trial"}</span>
            <h3>{subscription.data?.status ?? "trial"}</h3>
            <div className="progress-row">
              <span>الموظفون</span>
              <strong>{data?.active_users ?? 0}/{subscription.data?.max_users ?? "-"}</strong>
            </div>
            <div className="progress-track">
              <div style={{ width: `${Math.min(100, ((data?.active_users ?? 0) / Math.max(1, subscription.data?.max_users ?? 1)) * 100)}%` }} />
            </div>
            <div className="progress-row">
              <span>القنوات</span>
              <strong>{data?.total_channels ?? 0}/{subscription.data?.max_channels ?? "-"}</strong>
            </div>
            <div className="progress-track">
              <div style={{ width: `${Math.min(100, ((data?.total_channels ?? 0) / Math.max(1, subscription.data?.max_channels ?? 1)) * 100)}%` }} />
            </div>
            {subscription.data?.included_mac != null && (
              <>
                <div className="progress-row">
                  <span>MAC — مساحة العمل</span>
                  <strong>
                    {subscription.data.mac_count ?? 0}/{subscription.data.included_mac ?? "-"}
                    {" "}({formatMacUsagePercent(subscription.data.mac_count ?? 0, subscription.data.included_mac ?? 0)}%)
                  </strong>
                </div>
                <div className="progress-track">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        ((subscription.data.mac_count ?? 0) / Math.max(1, subscription.data.included_mac ?? 1)) * 100
                      )}%`
                    }}
                  />
                </div>
                {subscription.data.is_over_mac ? (
                  <small className="hint-text">
                    Over MAC: +{subscription.data.over_mac_count} · تقدير ${subscription.data.estimated_over_mac_charge?.toFixed(2) ?? "0"}
                  </small>
                ) : (
                  <small className="hint-text">
                    {subscription.data.mac_remaining ?? 0} MAC متبقٍ · {subscription.data.cycle_month ?? ""}
                  </small>
                )}
              </>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
