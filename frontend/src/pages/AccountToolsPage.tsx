import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import {
  formatMessagingLimit,
  formatQualityRating,
  qualityBadgeClass,
  type WhatsAppAccountRow,
  whatsappAccountLabel
} from "../lib/whatsappHelpers";
import { toastStore } from "../stores/toast";

type ToolTab = "insights" | "limits" | "flows";
type InsightsSubTab = "message-pricing" | "call-pricing";

type MessagingLimits = {
  whatsapp_account_id: string;
  display_phone_number: string;
  verified_name: string | null;
  quality_rating: string | null;
  quality_label_ar: string | null;
  messaging_limit_tier: string | null;
  messaging_limit: number | null;
  tier_hint_ar: string | null;
  used_unique_contacts_24h: number;
  remaining_unique_contacts_24h: number | null;
  usage_ratio: number | null;
  meta_phone_status: string | null;
  meta_can_send_message: string | null;
  meta_status_message: string | null;
  health_synced_at: string | null;
  usage_note_ar: string | null;
};

type PricingCategoryRow = {
  key: string;
  label_ar: string;
  volume: number;
  cost: number;
};

type MessagePricingInsights = {
  whatsapp_account_id: string;
  display_phone_number: string;
  start: string;
  end: string;
  local_messages: { sent: number; delivered: number; received: number };
  meta: {
    delivered_total: number;
    delivered_free: number;
    delivered_paid: number;
    approximate_cost: number;
    currency: string;
    by_category: PricingCategoryRow[];
    by_pricing_type: PricingCategoryRow[];
  };
  meta_error: string | null;
  note_ar: string;
};

type CallPricingInsights = {
  whatsapp_account_id: string;
  display_phone_number: string;
  start: string;
  end: string;
  meta: {
    calls_total: number;
    approximate_cost: number;
    currency: string;
    average_duration_seconds: number | null;
    by_direction: Array<{ key: string; count: number }>;
    by_type: Array<{ key: string; count: number }>;
  };
  meta_error: string | null;
  note_ar: string;
};

type FlowRow = {
  id: string;
  name?: string;
  status?: string;
  categories?: string[];
};

function defaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toInput = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toInput(start), end: toInput(end) };
}

function toIsoRange(startDate: string, endDate: string): { start: string; end: string } {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  return { start: start.toISOString(), end: end.toISOString() };
}

function money(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function usagePercent(ratio: number | null | undefined): number {
  if (ratio == null || Number.isNaN(ratio)) return 0;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

type MetricRow = { label: string; value: string | number };

function MetricCard({ title, rows, emphasizeFirst = false }: { title: string; rows: MetricRow[]; emphasizeFirst?: boolean }) {
  return (
    <article className="at-metric-card">
      <h3 className="at-metric-card-title">
        <span className="at-title-chip">{title}</span>
      </h3>
      <ul className="at-metric-rows">
        {rows.map((row, index) => (
          <li key={`${row.label}-${index}`} className={emphasizeFirst && index === 0 ? "at-metric-row at-metric-row-total" : "at-metric-row"}>
            <span className="at-metric-label">{row.label}</span>
            <span className="at-metric-dots" aria-hidden="true" />
            <strong className="at-metric-value">{row.value}</strong>
          </li>
        ))}
      </ul>
    </article>
  );
}

type TemplateOption = {
  id: string;
  name: string;
  whatsapp_account_id: string;
  status?: string;
};

const CATEGORY_ORDER = [
  "MARKETING",
  "MARKETING_LITE",
  "UTILITY",
  "AUTHENTICATION",
  "AUTHENTICATION_INTERNATIONAL",
  "SERVICE",
  "REFERRAL_CONVERSION"
];

function categoryMap(rows: PricingCategoryRow[]): Map<string, PricingCategoryRow> {
  return new Map(rows.map((row) => [row.key, row]));
}

function orderedCategoryRows(rows: PricingCategoryRow[], keys = CATEGORY_ORDER): PricingCategoryRow[] {
  const map = categoryMap(rows);
  const ordered = keys
    .map((key) => map.get(key) ?? { key, label_ar: key, volume: 0, cost: 0 })
    .filter((row) => map.has(row.key) || row.volume > 0 || row.cost > 0);
  const extras = rows.filter((row) => !keys.includes(row.key));
  return [...ordered, ...extras];
}

export default function AccountToolsPage() {
  const queryClient = useQueryClient();
  const [toolTab, setToolTab] = useState<ToolTab>("insights");
  const [insightsTab, setInsightsTab] = useState<InsightsSubTab>("message-pricing");
  const [accountId, setAccountId] = useState("");
  const rangeDefaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(rangeDefaults.start);
  const [endDate, setEndDate] = useState(rangeDefaults.end);
  const [flowName, setFlowName] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendFlowId, setSendFlowId] = useState("");
  const [sendCta, setSendCta] = useState("افتح");
  const [sendBody, setSendBody] = useState("أكمل النموذج");
  const [templateName, setTemplateName] = useState("");

  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });

  const selectedId = accountId || accounts.data?.[0]?.id || "";
  const selectedAccount = accounts.data?.find((item) => item.id === selectedId) ?? null;
  const isoRange = useMemo(() => toIsoRange(startDate, endDate), [startDate, endDate]);

  const templates = useQuery({
    queryKey: ["templates", "account-tools"],
    queryFn: async () => (await api.get<TemplateOption[]>("/templates")).data,
    enabled: toolTab === "insights" && insightsTab === "message-pricing"
  });

  const accountTemplates = useMemo(() => {
    const rows = (templates.data ?? []).filter((item) => item.whatsapp_account_id === selectedId);
    const unique = new Map<string, TemplateOption>();
    for (const row of rows) {
      if (!unique.has(row.name)) unique.set(row.name, row);
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [templates.data, selectedId]);

  const limits = useQuery({
    queryKey: ["whatsapp-messaging-limits", selectedId],
    enabled: Boolean(selectedId) && toolTab === "limits",
    queryFn: async () =>
      (await api.get<MessagingLimits>(`/whatsapp/accounts/${selectedId}/messaging-limits`)).data
  });

  const messagePricing = useQuery({
    queryKey: ["whatsapp-message-pricing", selectedId, isoRange.start, isoRange.end, templateName],
    enabled: Boolean(selectedId) && toolTab === "insights" && insightsTab === "message-pricing",
    queryFn: async () =>
      (
        await api.get<MessagePricingInsights>(
          `/whatsapp/accounts/${selectedId}/insights/message-pricing`,
          {
            params: {
              start: isoRange.start,
              end: isoRange.end,
              ...(templateName ? { template_name: templateName } : {})
            }
          }
        )
      ).data
  });

  const callPricing = useQuery({
    queryKey: ["whatsapp-call-pricing", selectedId, isoRange.start, isoRange.end],
    enabled: Boolean(selectedId) && toolTab === "insights" && insightsTab === "call-pricing",
    queryFn: async () =>
      (
        await api.get<CallPricingInsights>(
          `/whatsapp/accounts/${selectedId}/insights/call-pricing`,
          { params: { start: isoRange.start, end: isoRange.end } }
        )
      ).data
  });

  const flows = useQuery({
    queryKey: ["whatsapp-flows", selectedId],
    enabled: Boolean(selectedId) && toolTab === "flows",
    queryFn: async () =>
      (await api.get<{ flows: FlowRow[]; meta_error: string | null; note_ar: string }>(
        `/whatsapp/accounts/${selectedId}/flows`
      )).data
  });

  const refreshLimits = useMutation({
    mutationFn: async () =>
      (await api.get<MessagingLimits>(`/whatsapp/accounts/${selectedId}/messaging-limits`, {
        params: { refresh: true }
      })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["whatsapp-messaging-limits", selectedId], data);
      toastStore.getState().show("تمت مزامنة الحدود من Meta", "success");
    },
    onError: (error) => toastStore.getState().show(formatApiError(error), "error")
  });

  const createFlow = useMutation({
    mutationFn: async () =>
      (await api.post(`/whatsapp/accounts/${selectedId}/flows`, {
        name: flowName.trim(),
        categories: ["OTHER"]
      })).data,
    onSuccess: () => {
      setFlowName("");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-flows", selectedId] });
      toastStore.getState().show("تم إنشاء Flow في Meta", "success");
    },
    onError: (error) => toastStore.getState().show(formatApiError(error), "error")
  });

  const sendFlow = useMutation({
    mutationFn: async () =>
      (await api.post(`/whatsapp/accounts/${selectedId}/flows/send`, {
        to: sendTo.trim(),
        flow_id: sendFlowId.trim(),
        flow_cta: sendCta.trim() || "افتح",
        body_text: sendBody.trim() || "أكمل النموذج"
      })).data,
    onSuccess: () => toastStore.getState().show("تم إرسال الـ Flow", "success"),
    onError: (error) => toastStore.getState().show(formatApiError(error), "error")
  });

  const percent = usagePercent(limits.data?.usage_ratio);

  return (
    <main className="page whatsapp-connect-page account-tools-page">
      <header className="page-header at-page-header">
        <div className="at-page-title-card">
          <span className="eyebrow whatsapp-eyebrow">أدوات الحساب</span>
          <h1>أدوات حساب واتساب</h1>
          <p>الرؤى وتسعير الرسائل/المكالمات والحدود القصوى والفلوز — كما في WhatsApp Manager.</p>
        </div>
        <Link to="/whatsapp-connect" className="secondary-button">الحسابات المربوطة ←</Link>
      </header>

      <section className="card account-tools-toolbar">
        <label className="field-label">
          <span>رقم / حساب WhatsApp</span>
          <select
            value={selectedId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setTemplateName("");
            }}
            disabled={!accounts.data?.length}
          >
            {!accounts.data?.length && <option value="">لا توجد حسابات مربوطة</option>}
            {(accounts.data ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {whatsappAccountLabel(account)} · {account.display_phone_number}
              </option>
            ))}
          </select>
        </label>
        {selectedAccount && (
          <div className="account-tools-meta">
            <span className={qualityBadgeClass(selectedAccount.quality_rating)}>
              {formatQualityRating(selectedAccount.quality_rating)}
            </span>
            <span className="admin-chip">{formatMessagingLimit(selectedAccount)}</span>
            <small>WABA {selectedAccount.waba_id}</small>
          </div>
        )}
      </section>

      <div className="whatsapp-page-tabs">
        <button type="button" className={toolTab === "insights" ? "whatsapp-tab active" : "whatsapp-tab"} onClick={() => setToolTab("insights")}>
          الرؤى
        </button>
        <button type="button" className={toolTab === "limits" ? "whatsapp-tab active" : "whatsapp-tab"} onClick={() => setToolTab("limits")}>
          الحدود القصوى للرسائل
        </button>
        <button type="button" className={toolTab === "flows" ? "whatsapp-tab active" : "whatsapp-tab"} onClick={() => setToolTab("flows")}>
          الفلوز
        </button>
      </div>

      {toolTab === "insights" && (
        <section className="card account-tools-panel">
          <div className="whatsapp-page-tabs account-tools-subtabs">
            <button
              type="button"
              className={insightsTab === "message-pricing" ? "whatsapp-tab active" : "whatsapp-tab"}
              onClick={() => setInsightsTab("message-pricing")}
            >
              تسعير الرسائل
            </button>
            <button
              type="button"
              className={insightsTab === "call-pricing" ? "whatsapp-tab active" : "whatsapp-tab"}
              onClick={() => setInsightsTab("call-pricing")}
            >
              تسعير المكالمات
            </button>
          </div>

          <div className="admin-toolbar account-tools-filters">
            <label>
              من
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              إلى
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            {insightsTab === "message-pricing" && (
              <label>
                القالب
                <select value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
                  <option value="">كل القوالب</option>
                  {accountTemplates.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {insightsTab === "message-pricing" && (
            <>
              {messagePricing.isLoading && <p className="muted">جاري تحميل تسعير الرسائل…</p>}
              {messagePricing.data?.meta_error && (
                <p className="account-tools-warning">تعذر جلب بيانات Meta: {messagePricing.data.meta_error}</p>
              )}
              {messagePricing.data && (() => {
                const currency = messagePricing.data.meta.currency;
                const categories = orderedCategoryRows(messagePricing.data.meta.by_category);
                const freeTypes = messagePricing.data.meta.by_pricing_type.filter((row) => row.key.startsWith("FREE"));
                const paidCategories = categories.filter((row) => row.key !== "SERVICE" && row.key !== "REFERRAL_CONVERSION");
                const allMessagesTotal =
                  messagePricing.data.local_messages.sent +
                  messagePricing.data.meta.delivered_total +
                  messagePricing.data.local_messages.received;
                return (
                  <>
                    <div className="admin-stats-row admin-stats-row-brand at-summary-row">
                      <article className="admin-stat-card admin-stat-card-brand">
                        <span className="at-summary-label-chip">كل الرسائل</span>
                        <strong>{allMessagesTotal.toLocaleString("ar")}</strong>
                        <small>
                          مرسل {messagePricing.data.local_messages.sent.toLocaleString("ar")} · مسلّم{" "}
                          {messagePricing.data.meta.delivered_total.toLocaleString("ar")} · وارد{" "}
                          {messagePricing.data.local_messages.received.toLocaleString("ar")}
                        </small>
                      </article>
                      <article className="admin-stat-card admin-stat-card-brand">
                        <span className="at-summary-label-chip">الرسائل التي تم تسليمها</span>
                        <strong>{messagePricing.data.meta.delivered_total.toLocaleString("ar")}</strong>
                        <small>حسب Meta للفترة المحددة</small>
                      </article>
                      <article className="admin-stat-card admin-stat-card-brand">
                        <span className="at-summary-label-chip">الرسائل المجانية التي تم تسليمها</span>
                        <strong>{messagePricing.data.meta.delivered_free.toLocaleString("ar")}</strong>
                        <small>خدمة مجانية / نقطة دخول</small>
                      </article>
                      <article className="admin-stat-card admin-stat-card-brand">
                        <span className="at-summary-label-chip">الرسائل المدفوعة التي تم تسليمها</span>
                        <strong>{messagePricing.data.meta.delivered_paid.toLocaleString("ar")}</strong>
                        <small>تسويق / مساعدة / مصادقة</small>
                      </article>
                      <article className="admin-stat-card admin-stat-card-brand">
                        <span className="at-summary-label-chip">إجمالي الرسوم التقريبية</span>
                        <strong>{money(messagePricing.data.meta.approximate_cost, currency)}</strong>
                        <small>{templateName ? `فلتر القالب: ${templateName}` : "كل القوالب"}</small>
                      </article>
                    </div>

                    <div className="at-metric-grid at-metric-grid-top">
                      <MetricCard
                        title="كل الرسائل"
                        rows={[
                          { label: "الرسائل المرسلة", value: messagePricing.data.local_messages.sent },
                          { label: "الرسائل التي تم تسليمها", value: messagePricing.data.meta.delivered_total },
                          { label: "الرسائل الواردة", value: messagePricing.data.local_messages.received }
                        ]}
                      />
                      <MetricCard
                        title="الرسائل التي تم تسليمها"
                        emphasizeFirst
                        rows={[
                          { label: "الإجمالي", value: messagePricing.data.meta.delivered_total },
                          ...categories.map((row) => ({ label: row.label_ar, value: row.volume }))
                        ]}
                      />
                      <MetricCard
                        title="الرسائل المجانية التي تم تسليمها"
                        emphasizeFirst
                        rows={[
                          { label: "الإجمالي", value: messagePricing.data.meta.delivered_free },
                          ...(freeTypes.length
                            ? freeTypes.map((row) => ({ label: row.label_ar, value: row.volume }))
                            : [
                                { label: "مجاني — خدمة عملاء", value: 0 },
                                { label: "مجاني — نقطة دخول", value: 0 }
                              ])
                        ]}
                      />
                    </div>
                    <div className="at-metric-grid at-metric-grid-bottom">
                      <MetricCard
                        title="الرسائل المدفوعة التي تم تسليمها"
                        emphasizeFirst
                        rows={[
                          { label: "الإجمالي", value: messagePricing.data.meta.delivered_paid },
                          ...paidCategories.map((row) => ({ label: row.label_ar, value: row.volume }))
                        ]}
                      />
                      <MetricCard
                        title="إجمالي الرسوم التقريبية"
                        emphasizeFirst
                        rows={[
                          { label: "الإجمالي", value: money(messagePricing.data.meta.approximate_cost, currency) },
                          ...categories.map((row) => ({
                            label: row.label_ar,
                            value: money(row.cost, currency)
                          }))
                        ]}
                      />
                    </div>
                    <p className="muted">{messagePricing.data.note_ar}</p>
                  </>
                );
              })()}
            </>
          )}

          {insightsTab === "call-pricing" && (
            <>
              {callPricing.isLoading && <p className="muted">جاري تحميل تسعير المكالمات…</p>}
              {callPricing.data?.meta_error && (
                <p className="account-tools-warning">تعذر جلب بيانات المكالمات: {callPricing.data.meta_error}</p>
              )}
              {callPricing.data && (
                <>
                  <div className="at-metric-grid at-metric-grid-top">
                    <MetricCard
                      title="ملخص المكالمات"
                      rows={[
                        { label: "إجمالي المكالمات", value: callPricing.data.meta.calls_total },
                        {
                          label: "متوسط المدة (ث)",
                          value: callPricing.data.meta.average_duration_seconds ?? "—"
                        },
                        {
                          label: "رسوم تقريبية",
                          value: money(callPricing.data.meta.approximate_cost, callPricing.data.meta.currency)
                        }
                      ]}
                    />
                    <MetricCard
                      title="حسب الاتجاه"
                      rows={(callPricing.data.meta.by_direction.length
                        ? callPricing.data.meta.by_direction
                        : [{ key: "لا بيانات", count: 0 }]
                      ).map((row) => ({ label: row.key, value: row.count }))}
                    />
                    <MetricCard
                      title="حسب النوع"
                      rows={(callPricing.data.meta.by_type.length
                        ? callPricing.data.meta.by_type
                        : [{ key: "لا بيانات", count: 0 }]
                      ).map((row) => ({ label: row.key, value: row.count }))}
                    />
                  </div>
                  <p className="muted">{callPricing.data.note_ar}</p>
                </>
              )}
            </>
          )}
        </section>
      )}

      {toolTab === "limits" && (
        <section className="card account-tools-panel">
          <div className="admin-table-header">
            <div>
              <h2>الحدود القصوى للرسائل</h2>
              <small>{limits.data?.tier_hint_ar || "مزامنة جودة الرقم وحد المحادثات اليومية من Meta"}</small>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={!selectedId || refreshLimits.isPending}
              onClick={() => refreshLimits.mutate()}
            >
              {refreshLimits.isPending ? "جاري المزامنة…" : "مزامنة من Meta"}
            </button>
          </div>

          {limits.isLoading && <p className="muted">جاري التحميل…</p>}
          {limits.data && (
            <>
              <div className="at-metric-grid at-metric-grid-top">
                <MetricCard
                  title="حد الإرسال"
                  rows={[
                    { label: "المستوى", value: limits.data.messaging_limit_tier || "—" },
                    {
                      label: "الحد / 24س",
                      value: limits.data.messaging_limit?.toLocaleString("ar") ?? "غير محدود"
                    },
                    { label: "الجودة", value: limits.data.quality_label_ar || "—" }
                  ]}
                />
                <MetricCard
                  title="الاستخدام التقديري"
                  emphasizeFirst
                  rows={[
                    { label: "نسبة الاستخدام", value: `${percent}%` },
                    {
                      label: "مستخدم (جهات فريدة / 24س)",
                      value: limits.data.used_unique_contacts_24h.toLocaleString("ar")
                    },
                    {
                      label: "متبقي",
                      value:
                        limits.data.remaining_unique_contacts_24h == null
                          ? "—"
                          : limits.data.remaining_unique_contacts_24h.toLocaleString("ar")
                    }
                  ]}
                />
                <MetricCard
                  title="حالة Meta"
                  rows={[
                    { label: "الإرسال", value: limits.data.meta_can_send_message || "—" },
                    { label: "حالة الرقم", value: limits.data.meta_phone_status || "—" },
                    {
                      label: "آخر مزامنة",
                      value: limits.data.health_synced_at
                        ? new Date(limits.data.health_synced_at).toLocaleString("ar")
                        : "—"
                    }
                  ]}
                />
              </div>
              <div className="account-tools-progress">
                <div className="account-tools-progress-bar" style={{ width: `${percent}%` }} />
              </div>
              <p className="muted">{percent}% من الحد اليومي التقديري</p>
              {limits.data.meta_status_message && (
                <p className="account-tools-warning">{limits.data.meta_status_message}</p>
              )}
              <p className="muted">{limits.data.usage_note_ar}</p>
            </>
          )}
        </section>
      )}

      {toolTab === "flows" && (
        <section className="card account-tools-panel">
          <div className="admin-table-header">
            <div>
              <h2>الفلوز (WhatsApp Flows)</h2>
              <small>{flows.data?.note_ar || "نماذج تفاعلية من Meta — ليست أتمتة واتسلي"}</small>
            </div>
          </div>

          {flows.data?.meta_error && (
            <p className="account-tools-warning">تعذر جلب الفلوز: {flows.data.meta_error}</p>
          )}

          <div className="at-metric-grid at-metric-grid-flows">
            <article className="at-metric-card">
              <h3 className="at-metric-card-title">إنشاء Flow</h3>
              <div className="account-tools-form">
                <input
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                  placeholder="اسم الـ Flow"
                />
                <button
                  type="button"
                  className="primary-button"
                  disabled={!selectedId || !flowName.trim() || createFlow.isPending}
                  onClick={() => createFlow.mutate()}
                >
                  إنشاء في Meta
                </button>
              </div>
              <h3 className="at-metric-card-title">إرسال Flow</h3>
              <div className="account-tools-form" style={{ marginBottom: 0 }}>
                <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="رقم المستلم" />
                <input value={sendFlowId} onChange={(e) => setSendFlowId(e.target.value)} placeholder="Flow ID" />
                <input value={sendCta} onChange={(e) => setSendCta(e.target.value)} placeholder="نص الزر" />
                <textarea value={sendBody} onChange={(e) => setSendBody(e.target.value)} placeholder="نص الرسالة" rows={3} />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!selectedId || !sendTo.trim() || !sendFlowId.trim() || sendFlow.isPending}
                  onClick={() => sendFlow.mutate()}
                >
                  إرسال
                </button>
              </div>
            </article>

            <article className="at-metric-card">
              <h3 className="at-metric-card-title">قائمة الفلوز</h3>
              {flows.isLoading && <p className="muted">جاري التحميل…</p>}
              <ul className="at-metric-rows">
                {(flows.data?.flows?.length ? flows.data.flows : []).map((flow) => (
                  <li key={flow.id} className="at-metric-row">
                    <button type="button" className="linkish at-metric-label" onClick={() => setSendFlowId(flow.id)}>
                      {flow.name || flow.id}
                    </button>
                    <span className="at-metric-dots" aria-hidden="true" />
                    <strong className="at-metric-value">{flow.status || "—"}</strong>
                  </li>
                ))}
                {!flows.isLoading && !(flows.data?.flows?.length) && (
                  <li className="at-metric-row">
                    <span className="at-metric-label">لا توجد Flows بعد</span>
                    <span className="at-metric-dots" aria-hidden="true" />
                    <strong className="at-metric-value">0</strong>
                  </li>
                )}
              </ul>
            </article>
          </div>
        </section>
      )}
    </main>
  );
}
