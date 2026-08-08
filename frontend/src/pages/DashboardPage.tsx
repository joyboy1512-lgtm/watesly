import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import Icon from "../components/Icon";

type CurrentUser = { full_name: string };

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
  { to: "/catalog/new", label: "منتج أو خدمة", hint: "إضافة للكتalog", icon: "template" as const },
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
  const profile = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<CurrentUser>("/auth/me")).data
  });

  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get<DashboardSummary>("/dashboard/summary")).data,
    refetchInterval: 60_000
  });

  const subscription = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      try {
        return (await api.get("/billing/subscription")).data;
      } catch (error) {
        if (error && typeof error === "object" && "response" in error) {
          const status = (error as { response?: { status?: number } }).response?.status;
          if (status === 404) return null;
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
      to: "/inbox"
    },
    {
      label: "الرسائل اليوم",
      value: String((data?.sent_messages_today ?? 0) + (data?.received_messages_today ?? 0)),
      change: `${data?.received_messages_today ?? 0} واردة · ${data?.sent_messages_today ?? 0} صادرة`,
      icon: "dashboard" as const,
      to: "/inbox"
    },
    {
      label: "CSAT",
      value: data?.csat_average != null ? `${data.csat_average} ★` : "—",
      change: data?.csat_total_ratings ? `${data.csat_total_ratings} تقييم · ${data.csat_promoters_pct ?? 0}% ≥4` : "لا توجد تقييمات بعد",
      icon: "dashboard" as const,
      to: "/analytics"
    },
    {
      label: "متوسط أول رد",
      value: data?.first_response_avg_minutes != null ? `${data.first_response_avg_minutes} د` : "—",
      change: "آخر 7 أيام",
      icon: "team" as const,
      to: "/analytics"
    }
  ] as const;

  const campaign = data?.latest_campaign;

  return (
    <main className="page page-dashboard">
      <section className="hero-card">
        <div>
          <span className="eyebrow">{t("eyebrow.wateslyWorkspace")}</span>
          <h1>مرحبًا، {profile.data?.full_name?.split(" ")[0] ?? "فريق Watesly"} 👋</h1>
          <p>إليك ملخص أداء فريقك وقنوات التواصل اليوم.</p>
        </div>
        <div className="hero-actions">
          <Link to="/campaigns?action=create" className="hero-action-link primary-action">
            إنشاء حملة جديدة
          </Link>
          <Link to="/catalog/new" className="hero-action-link primary-action whatsapp-button">
            + إضافة منتجات وخدمات
          </Link>
        </div>
      </section>

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

      <section className="dashboard-quick-actions">
        {quickActions.map((item) => (
          <Link key={item.to} to={item.to} className="dashboard-quick-card">
            <span className="metric-icon"><Icon name={item.icon} /></span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </div>
          </Link>
        ))}
      </section>

      <section className="stats-grid premium">
        {stats.map((item) => (
          <Link to={item.to} className="metric-card metric-card-link" key={item.label}>
            <div className="metric-icon"><Icon name={item.icon} /></div>
            <div>
              <span>{item.label}</span>
              <strong>{summary.isLoading ? "…" : item.value}</strong>
              <small>{item.change}</small>
            </div>
          </Link>
        ))}
      </section>

      <section className="dashboard-grid dashboard-grid-wide">
        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>تنتظر ردّك</h2>
              <p>آخر محادثات برسالة واردة من العميل</p>
            </div>
            <Link to="/inbox" className="secondary-button">صندوق الوارد</Link>
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

        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>آخر حملة</h2>
              <p>حالة الإرسال والتسليم</p>
            </div>
            {campaign && (
              <Link to="/campaigns" className="secondary-button">كل الحملات</Link>
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
              <div className="campaign-preflight-stats">
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

      <section className="dashboard-grid">
        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>ملخص المحادثات</h2>
              <p>الحالة الحالية</p>
            </div>
          </div>
          <div className="summary-list">
            <Link to="/inbox" className="summary-list-link"><span>مفتوحة</span><strong>{data?.open_conversations ?? 0}</strong></Link>
            <Link to="/inbox" className="summary-list-link"><span>قيد الانتظار</span><strong>{data?.pending_conversations ?? 0}</strong></Link>
            <div><span>مغلقة</span><strong>{data?.closed_conversations ?? 0}</strong></div>
            <Link to="/contacts" className="summary-list-link"><span>جهات الاتصال</span><strong>{data?.total_contacts ?? 0}</strong></Link>
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>الاشتراك</h2>
              <p>استخدام الخطة الحالية</p>
            </div>
            <Link to="/billing" className="secondary-button">الفوترة</Link>
          </div>
          <div className="plan-card">
            <span className="plan-badge">{subscription.data?.plan_name ?? "Trial"}</span>
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
                  <span>MAC (عملاء نشطون)</span>
                  <strong>
                    {subscription.data.mac_count ?? 0}/{subscription.data.included_mac ?? "-"}
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
