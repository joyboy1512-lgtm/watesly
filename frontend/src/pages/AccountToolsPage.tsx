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

  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });

  const selectedId = accountId || accounts.data?.[0]?.id || "";
  const selectedAccount = accounts.data?.find((item) => item.id === selectedId) ?? null;
  const isoRange = useMemo(() => toIsoRange(startDate, endDate), [startDate, endDate]);

  const limits = useQuery({
    queryKey: ["whatsapp-messaging-limits", selectedId],
    enabled: Boolean(selectedId) && toolTab === "limits",
    queryFn: async () =>
      (await api.get<MessagingLimits>(`/whatsapp/accounts/${selectedId}/messaging-limits`)).data
  });

  const messagePricing = useQuery({
    queryKey: ["whatsapp-message-pricing", selectedId, isoRange.start, isoRange.end],
    enabled: Boolean(selectedId) && toolTab === "insights" && insightsTab === "message-pricing",
    queryFn: async () =>
      (
        await api.get<MessagePricingInsights>(
          `/whatsapp/accounts/${selectedId}/insights/message-pricing`,
          { params: { start: isoRange.start, end: isoRange.end } }
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
      <header className="page-header">
        <div>
          <span className="eyebrow whatsapp-eyebrow">أدوات الحساب</span>
          <h1>أدوات حساب WhatsApp</h1>
          <p>الرؤى وتسعير الرسائل/المكالمات والحدود القصوى والفلوز — كما في WhatsApp Manager.</p>
        </div>
        <Link to="/whatsapp-connect" className="secondary-button">الحسابات المربوطة ←</Link>
      </header>

      <section className="card account-tools-toolbar">
        <label className="field-label">
          <span>رقم / حساب WhatsApp</span>
          <select value={selectedId} onChange={(e) => setAccountId(e.target.value)} disabled={!accounts.data?.length}>
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
          </div>

          {insightsTab === "message-pricing" && (
            <>
              {messagePricing.isLoading && <p className="muted">جاري تحميل تسعير الرسائل…</p>}
              {messagePricing.data?.meta_error && (
                <p className="account-tools-warning">تعذر جلب بيانات Meta: {messagePricing.data.meta_error}</p>
              )}
              {messagePricing.data && (
                <>
                  <div className="admin-stats-row admin-stats-row-brand">
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>مرسل (محلي)</span>
                      <strong>{messagePricing.data.local_messages.sent}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>مسلّم (Meta)</span>
                      <strong>{messagePricing.data.meta.delivered_total}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>مجاني</span>
                      <strong>{messagePricing.data.meta.delivered_free}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>مدفوع</span>
                      <strong>{messagePricing.data.meta.delivered_paid}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>رسوم تقريبية</span>
                      <strong>{money(messagePricing.data.meta.approximate_cost, messagePricing.data.meta.currency)}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>وارد (محلي)</span>
                      <strong>{messagePricing.data.local_messages.received}</strong>
                    </article>
                  </div>

                  <div className="account-tools-split">
                    <div>
                      <h3>حسب الفئة</h3>
                      <table className="admin-erp-table">
                        <thead>
                          <tr>
                            <th>الفئة</th>
                            <th>الكمية</th>
                            <th>التكلفة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(messagePricing.data.meta.by_category.length ? messagePricing.data.meta.by_category : [{ key: "-", label_ar: "لا بيانات", volume: 0, cost: 0 }]).map((row) => (
                            <tr key={row.key}>
                              <td>{row.label_ar}</td>
                              <td>{row.volume}</td>
                              <td>{money(row.cost, messagePricing.data.meta.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <h3>مجاني / مدفوع</h3>
                      <table className="admin-erp-table">
                        <thead>
                          <tr>
                            <th>النوع</th>
                            <th>الكمية</th>
                            <th>التكلفة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(messagePricing.data.meta.by_pricing_type.length ? messagePricing.data.meta.by_pricing_type : [{ key: "-", label_ar: "لا بيانات", volume: 0, cost: 0 }]).map((row) => (
                            <tr key={row.key}>
                              <td>{row.label_ar}</td>
                              <td>{row.volume}</td>
                              <td>{money(row.cost, messagePricing.data.meta.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="muted">{messagePricing.data.note_ar}</p>
                </>
              )}
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
                  <div className="admin-stats-row admin-stats-row-brand">
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>إجمالي المكالمات</span>
                      <strong>{callPricing.data.meta.calls_total}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>رسوم تقريبية</span>
                      <strong>{money(callPricing.data.meta.approximate_cost, callPricing.data.meta.currency)}</strong>
                    </article>
                    <article className="admin-stat-card admin-stat-card-brand">
                      <span>متوسط المدة (ث)</span>
                      <strong>{callPricing.data.meta.average_duration_seconds ?? "—"}</strong>
                    </article>
                  </div>
                  <div className="account-tools-split">
                    <div>
                      <h3>حسب الاتجاه</h3>
                      <ul className="account-tools-list">
                        {(callPricing.data.meta.by_direction.length ? callPricing.data.meta.by_direction : [{ key: "لا بيانات", count: 0 }]).map((row) => (
                          <li key={row.key}><span>{row.key}</span><strong>{row.count}</strong></li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3>حسب النوع</h3>
                      <ul className="account-tools-list">
                        {(callPricing.data.meta.by_type.length ? callPricing.data.meta.by_type : [{ key: "لا بيانات", count: 0 }]).map((row) => (
                          <li key={row.key}><span>{row.key}</span><strong>{row.count}</strong></li>
                        ))}
                      </ul>
                    </div>
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
              <div className="admin-stats-row admin-stats-row-brand">
                <article className="admin-stat-card admin-stat-card-brand">
                  <span>المستوى</span>
                  <strong>{limits.data.messaging_limit_tier || "—"}</strong>
                </article>
                <article className="admin-stat-card admin-stat-card-brand">
                  <span>الحد / 24س</span>
                  <strong>{limits.data.messaging_limit?.toLocaleString("ar") ?? "غير محدود"}</strong>
                </article>
                <article className="admin-stat-card admin-stat-card-brand">
                  <span>مستخدم (تقديري)</span>
                  <strong>{limits.data.used_unique_contacts_24h.toLocaleString("ar")}</strong>
                </article>
                <article className="admin-stat-card admin-stat-card-brand">
                  <span>متبقي</span>
                  <strong>
                    {limits.data.remaining_unique_contacts_24h == null
                      ? "—"
                      : limits.data.remaining_unique_contacts_24h.toLocaleString("ar")}
                  </strong>
                </article>
                <article className="admin-stat-card admin-stat-card-brand">
                  <span>الجودة</span>
                  <strong>{limits.data.quality_label_ar || "—"}</strong>
                </article>
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

          <div className="account-tools-split">
            <div>
              <h3>إنشاء Flow</h3>
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

              <h3>إرسال Flow</h3>
              <div className="account-tools-form">
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
            </div>

            <div>
              <h3>القائمة</h3>
              {flows.isLoading && <p className="muted">جاري التحميل…</p>}
              <table className="admin-erp-table">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>الحالة</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {(flows.data?.flows?.length ? flows.data.flows : []).map((flow) => (
                    <tr key={flow.id}>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => setSendFlowId(flow.id)}
                        >
                          {flow.name || flow.id}
                        </button>
                      </td>
                      <td>{flow.status || "—"}</td>
                      <td><code>{flow.id}</code></td>
                    </tr>
                  ))}
                  {!flows.isLoading && !(flows.data?.flows?.length) && (
                    <tr><td colSpan={3} className="admin-table-empty">لا توجد Flows بعد.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
