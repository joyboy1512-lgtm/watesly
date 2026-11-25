import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api, silentRequest } from "../lib/api";
import Icon from "../components/Icon";
import MacWorkspaceBalance from "../components/MacWorkspaceBalance";
import { formatMacUsagePercent } from "../lib/macHelpers";
import { useCurrentUser, useHasPermission } from "../hooks/usePermissions";
import { useWorkspaceOrganizationId } from "../hooks/useWorkspace";

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

type AttentionCard = {
  id: string;
  label: string;
  count: number | null;
  href: string;
  status: "ok" | "unavailable" | "error" | string;
  hint?: string | null;
  meta?: string | null;
};

type AttentionPayload = {
  role: string;
  audience: "employee" | "supervisor" | "owner" | string;
  updated_at: string;
  question: string;
  primary_action: {
    title: string;
    detail: string;
    href: string;
    count: number | null;
  };
  cards: AttentionCard[];
  waiting_reply_count: number;
  waiting_preview: WaitingConversation[];
};

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

const AUDIENCE_LABELS: Record<string, string> = {
  employee: "عرض الموظف",
  supervisor: "عرض المشرف",
  owner: "عرض المالك"
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
  return new Intl.DateTimeFormat("ar", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short"
  }).format(new Date(value));
}

function formatUpdatedAt(value: string | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "numeric",
    month: "short"
  }).format(new Date(value));
}

function cardValue(card: AttentionCard, loading: boolean, failed: boolean) {
  if (failed || card.status === "error") return "تعذّر التحميل";
  if (card.status === "unavailable") return "غير متاح";
  if (loading) return "…";
  if (card.count == null) return "—";
  return String(card.count);
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const profile = useCurrentUser();
  const canViewReports = useHasPermission("reports.view");
  const canViewBilling = useHasPermission("billing.view");
  const canViewConversations = useHasPermission("conversations.view");
  const workspaceOrganizationId = useWorkspaceOrganizationId();

  const attention = useQuery({
    queryKey: ["dashboard-attention", workspaceOrganizationId],
    enabled: canViewConversations,
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (workspaceOrganizationId) params.organization_id = workspaceOrganizationId;
      return (
        await api.get<AttentionPayload>("/dashboard/attention", {
          params,
          ...silentRequest
        })
      ).data;
    },
    refetchInterval: canViewConversations ? 60_000 : false
  });

  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    enabled: canViewReports,
    queryFn: async () => (await api.get<DashboardSummary>("/dashboard/summary")).data,
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
  const attentionData = attention.data;
  const firstName = profile.data?.full_name?.split(" ")[0] ?? "فريق Watesly";
  const campaign = data?.latest_campaign;
  const primary = attentionData?.primary_action;
  const attentionFailed = attention.isError;
  const attentionLoading = attention.isLoading;

  return (
    <main className="page page-dashboard">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-hero-eyebrow">{t("eyebrow.wateslyWorkspace")}</span>
          <h1>مرحباً، {firstName}</h1>
          <p>{attentionData?.question ?? "ماذا يتطلب انتباهي اليوم؟"}</p>
          {attentionData?.audience && (
            <small className="dashboard-audience-chip">
              {AUDIENCE_LABELS[attentionData.audience] ?? attentionData.audience}
              {attentionData.role ? ` · ${attentionData.role}` : ""}
            </small>
          )}
        </div>
        <div className="dashboard-hero-actions">
          {primary ? (
            <Link to={primary.href} className="dashboard-hero-btn dashboard-hero-btn-primary">
              {primary.title}
              {primary.count != null && primary.count > 0 ? ` (${primary.count})` : ""}
            </Link>
          ) : (
            <Link to="/inbox" className="dashboard-hero-btn dashboard-hero-btn-primary">
              فتح صندوق الوارد
            </Link>
          )}
          {canViewReports && (
            <Link to="/campaigns?action=create" className="dashboard-hero-btn dashboard-hero-btn-ghost">
              إنشاء حملة
            </Link>
          )}
        </div>
      </section>

      {primary && (
        <section className="dashboard-primary-action" aria-label="أهم إجراء اليوم">
          <div className="dashboard-primary-copy">
            <span>أهم إجراء الآن</span>
            <strong>{primary.title}</strong>
            <p>{primary.detail}</p>
          </div>
          <Link to={primary.href} className="whatsapp-button">
            فتح
          </Link>
        </section>
      )}

      <section className="dashboard-attention" aria-label="بطاقات الانتباه">
        <div className="dashboard-attention-head">
          <div>
            <h2>يتطلب انتباهك</h2>
            <p>كل بطاقة تفتح قائمة بنفس الفلتر والحالة.</p>
          </div>
          <small className="dashboard-updated-at">
            آخر تحديث:{" "}
            {attentionFailed
              ? "تعذّر التحديث"
              : attentionLoading
                ? "جاري التحديث…"
                : formatUpdatedAt(attentionData?.updated_at)}
          </small>
        </div>

        {!canViewConversations && (
          <p className="hint-text">لا توجد صلاحية لعرض محادثات الانتباه (conversations.view).</p>
        )}

        {canViewConversations && attentionFailed && (
          <p className="dashboard-attention-error" role="alert">
            تعذّر تحميل مؤشرات الانتباه. الأرقام أدناه غير موثوقة حتى يعاد التحميل.
          </p>
        )}

        {canViewConversations && (
          <div className="dashboard-attention-grid">
            {(attentionData?.cards ?? (attentionLoading ? [{ id: "loading", label: "…", count: null, href: "#", status: "ok" }] : [])).map(
              (card) => {
                const unavailable = card.status === "unavailable" || card.status === "error" || attentionFailed;
                const content = (
                  <>
                    <span className="dashboard-attention-label">{card.label}</span>
                    <strong className="dashboard-attention-value">
                      {cardValue(card, attentionLoading, attentionFailed)}
                    </strong>
                    <small className="dashboard-attention-meta">
                      {unavailable
                        ? card.hint || "غير متاح لهذا الدور/الصلاحية"
                        : card.meta || card.hint || "اضغط للفتح"}
                    </small>
                  </>
                );
                if (unavailable || card.href === "#") {
                  return (
                    <div
                      key={card.id}
                      className={`brand-stat-card dashboard-attention-card dashboard-attention-${card.status}${attentionFailed ? " is-error" : ""}`}
                      aria-disabled="true"
                    >
                      {content}
                    </div>
                  );
                }
                return (
                  <Link
                    key={card.id}
                    to={card.href}
                    className={`brand-stat-card dashboard-attention-card dashboard-attention-${card.status}${card.count ? " has-count" : ""}`}
                  >
                    {content}
                  </Link>
                );
              }
            )}
          </div>
        )}

        {canViewConversations && !attentionLoading && !attentionFailed && attentionData?.waiting_reply_count === 0 && (
          <p className="hint-text">صفر حقيقي: لا محادثات تنتظر الرد وفق تعريف صندوق الوارد.</p>
        )}
      </section>

      {canViewConversations && (attentionData?.waiting_preview?.length ?? 0) > 0 && (
        <section className="dashboard-panel dashboard-panel-green" aria-label="معاينة من ينتظر الرد">
          <div className="dashboard-panel-head">
            <div>
              <h2>أحدث من ينتظر الرد</h2>
              <p>نفس تعريف «تنتظر الرد» في الوارد</p>
            </div>
            <Link
              to={attentionData?.cards.find((c) => c.id === "waiting_reply")?.href || "/inbox?filter=waiting&needs_reply=1"}
              className="dashboard-panel-link"
            >
              عرض الكل ({attentionData?.waiting_reply_count ?? 0})
            </Link>
          </div>
          <div className="dashboard-waiting-list">
            {(attentionData?.waiting_preview ?? []).map((item) => (
              <Link
                key={item.id}
                to={`/inbox?conversation=${item.id}&filter=waiting&needs_reply=1`}
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
        </section>
      )}

      {subscription.data?.included_mac != null && canViewBilling && (
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

      {canViewReports && (data?.alerts ?? []).length > 0 && (
        <section className="dashboard-alerts">
          {(data?.alerts ?? []).map((alert) =>
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
          )}
        </section>
      )}

      {canViewReports && (
        <section className="dashboard-split">
          <article className="dashboard-panel dashboard-panel-green">
            <div className="dashboard-panel-head">
              <div>
                <h2>ملخص المحادثات</h2>
                <p>يتطلب reports.view</p>
              </div>
            </div>
            {summary.isError ? (
              <p className="hint-text">تعذّر تحميل الملخص.</p>
            ) : (
              <div className="dashboard-summary-list">
                <Link to="/inbox?filter=engaged" className="dashboard-summary-item">
                  <span>مفتوحة</span>
                  <strong>{summary.isLoading ? "…" : data?.open_conversations ?? 0}</strong>
                </Link>
                <Link to="/inbox?filter=waiting&needs_reply=1" className="dashboard-summary-item">
                  <span>تنتظر الرد</span>
                  <strong>
                    {attentionFailed
                      ? "—"
                      : attentionLoading
                        ? "…"
                        : attentionData?.waiting_reply_count ?? 0}
                  </strong>
                </Link>
                <div className="dashboard-summary-item">
                  <span>مغلقة</span>
                  <strong>{summary.isLoading ? "…" : data?.closed_conversations ?? 0}</strong>
                </div>
                <Link to="/contacts" className="dashboard-summary-item">
                  <span>جهات الاتصال</span>
                  <strong>{summary.isLoading ? "…" : data?.total_contacts ?? 0}</strong>
                </Link>
              </div>
            )}
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
            {summary.isError && <p className="hint-text">تعذّر تحميل بيانات الحملة.</p>}
            {!campaign && !summary.isLoading && !summary.isError && (
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
      )}

      {!canViewReports && canViewConversations && (
        <p className="hint-text">ملخص الأداء الكامل يتطلب صلاحية reports.view — يظهر هنا انتباه محادثاتك فقط.</p>
      )}
    </main>
  );
}
