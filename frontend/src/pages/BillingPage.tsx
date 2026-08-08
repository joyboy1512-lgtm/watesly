import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, silentRequest } from "../lib/api";
import {
  formatMacBalance,
  formatMacCycleMonth,
  macBalanceClass,
  macUsagePercent
} from "../lib/channelHelpers";
import { formatAppTime } from "../lib/language";

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
  campaign_messages_sent: number;
  whatsapp_status: string | null;
  whatsapp_phone: string | null;
};

type MacContact = {
  id: string;
  channel_id: string;
  channel_name: string | null;
  contact_id: string;
  contact_display_name: string | null;
  contact_phone: string | null;
  cycle_month: string;
  trigger_source: string;
  first_activity_at: string;
};

const TRIGGER_LABELS: Record<string, string> = {
  inbound: "رسالة واردة",
  inbox_outbound: "رد من Inbox"
};

function formatTrigger(source: string): string {
  return TRIGGER_LABELS[source] ?? source;
}

export default function BillingPage() {
  const [channelFilter, setChannelFilter] = useState("");
  const [contactOffset, setContactOffset] = useState(0);
  const contactLimit = 50;

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

  const contacts = useQuery({
    queryKey: ["billing-mac-contacts", channelFilter, contactOffset],
    enabled: subscription.isSuccess,
    queryFn: async () => {
      const params: Record<string, string | number> = {
        limit: contactLimit,
        offset: contactOffset
      };
      if (channelFilter) params.channel_id = channelFilter;
      return (await api.get<MacContact[]>("/billing/mac/contacts", { params, ...silentRequest })).data;
    }
  });

  const sub = subscription.data;
  const denied = subscription.error && typeof subscription.error === "object" && "response" in subscription.error
    && (subscription.error as { response?: { status?: number } }).response?.status === 403;

  const channelOptions = useMemo(
    () => channels.data ?? [],
    [channels.data]
  );

  if (subscription.isLoading) {
    return (
      <main className="page">
        <div className="inbox-state">جاري تحميل الفوترة…</div>
      </main>
    );
  }

  if (denied) {
    return (
      <main className="page">
        <header className="page-header">
          <h1>الفوترة و MAC</h1>
          <p>ليست لديك صلاحية عرض الفوترة. تواصل مع مالك الحساب.</p>
        </header>
      </main>
    );
  }

  if (subscription.isError || !sub) {
    return (
      <main className="page">
        <header className="page-header">
          <h1>الفوترة و MAC</h1>
          <p>لا يوجد اشتراك نشط حالياً.</p>
        </header>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>الفوترة و MAC</h1>
          <p>
            Monthly Active Contacts — دورة {formatMacCycleMonth(sub.cycle_month)} ·
            {" "}الخطة: {sub.plan_name}
          </p>
        </div>
        <Link to="/channels" className="secondary-button">عرض القنوات ←</Link>
      </header>

      <section className="admin-stats-row">
        <article className="admin-stat-card">
          <span>MAC المستخدم</span>
          <strong>{formatMacBalance(sub.mac_count, sub.included_mac)}</strong>
        </article>
        <article className="admin-stat-card">
          <span>المتبقي</span>
          <strong>{sub.is_over_mac ? "0" : sub.mac_remaining.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card">
          <span>حالة الرصيد</span>
          <strong className={macBalanceClass(sub.is_over_mac, sub.mac_count, sub.included_mac)}>
            {sub.is_over_mac ? `Over MAC +${sub.over_mac_count}` : "ضمن الخطة"}
          </strong>
        </article>
        <article className="admin-stat-card">
          <span>{sub.is_over_mac ? "تقدير Over MAC" : "سعر Over MAC"}</span>
          <strong>
            {sub.is_over_mac
              ? `$${sub.estimated_over_mac_charge.toFixed(2)}`
              : `$${sub.over_mac_price_per_100}/100`}
          </strong>
        </article>
      </section>

      {sub.is_over_mac && (
        <section className="card admin-note-card">
          <p>
            تجاوزت {sub.included_mac.toLocaleString("ar")} MAC المشمولة.
            الزيادة {sub.over_mac_count.toLocaleString("ar")} MAC
            ({sub.over_mac_blocks} × 100) ·
            ${sub.over_mac_price_per_100} لكل 100 MAC ·
            تقدير: ${sub.estimated_over_mac_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="card admin-table-card billing-plan-card">
        <div className="admin-table-header">
          <div>
            <h2>ملخص الاشتراك</h2>
            <small>{sub.status} · {sub.billing_cycle}</small>
          </div>
        </div>
        <div className="billing-plan-grid">
          <div><span>الموظفون</span><strong>{sub.max_users}</strong></div>
          <div><span>القنوات</span><strong>{sub.max_channels}</strong></div>
          <div><span>MAC مشمول</span><strong>{sub.included_mac.toLocaleString("ar")}</strong></div>
          <div><span>ينتهي</span><strong>{formatAppTime(sub.ends_at)}</strong></div>
        </div>
        <div className="progress-row">
          <span>استخدام MAC</span>
          <strong>{sub.mac_count}/{sub.included_mac}</strong>
        </div>
        <div className="progress-track">
          <div style={{ width: `${macUsagePercent(sub.mac_count, sub.included_mac)}%` }} />
        </div>
      </section>

      <section className="card admin-table-card">
        <div className="admin-table-header">
          <div>
            <h2>MAC حسب القناة</h2>
            <small>مساهمة كل قناة · الحملات تُحسب برسائل منفصلة</small>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table">
            <thead>
              <tr>
                <th>القناة</th>
                <th>MAC</th>
                <th>رسائل حملة</th>
                <th>WhatsApp</th>
                <th>حالة</th>
              </tr>
            </thead>
            <tbody>
              {channels.isLoading && (
                <tr><td colSpan={5} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {(channels.data ?? []).map((item) => (
                <tr key={item.channel_id}>
                  <td><strong>{item.channel_name}</strong></td>
                  <td>{item.mac_count.toLocaleString("ar")}</td>
                  <td>{item.campaign_messages_sent.toLocaleString("ar")}</td>
                  <td dir="ltr">{item.whatsapp_phone ?? "—"}</td>
                  <td>{item.channel_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card admin-table-card">
        <div className="admin-table-header">
          <div>
            <h2>جهات MAC النشطة</h2>
            <small>عميل واحد = MAC واحد لكل قناة في الشهر</small>
          </div>
        </div>
        <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
          <select
            value={channelFilter}
            onChange={(event) => {
              setChannelFilter(event.target.value);
              setContactOffset(0);
            }}
          >
            <option value="">كل القنوات</option>
            {channelOptions.map((item) => (
              <option key={item.channel_id} value={item.channel_id}>{item.channel_name}</option>
            ))}
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>الهاتف</th>
                <th>القناة</th>
                <th>المحفّز</th>
                <th>أول نشاط</th>
              </tr>
            </thead>
            <tbody>
              {contacts.isLoading && (
                <tr><td colSpan={5} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!contacts.isLoading && (contacts.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="admin-table-empty">لا توجد جهات MAC في هذه الدورة بعد.</td></tr>
              )}
              {(contacts.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.contact_display_name ?? "—"}</td>
                  <td dir="ltr">{item.contact_phone ?? "—"}</td>
                  <td>{item.channel_name ?? "—"}</td>
                  <td>{formatTrigger(item.trigger_source)}</td>
                  <td>{formatAppTime(item.first_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="billing-pagination">
          <button
            type="button"
            className="secondary-button"
            disabled={contactOffset === 0}
            onClick={() => setContactOffset(Math.max(0, contactOffset - contactLimit))}
          >
            السابق
          </button>
          <span>{contactOffset + 1}–{contactOffset + (contacts.data?.length ?? 0)}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={(contacts.data?.length ?? 0) < contactLimit}
            onClick={() => setContactOffset(contactOffset + contactLimit)}
          >
            التالي
          </button>
        </div>
      </section>
    </main>
  );
}
