import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";
import {
  channelPurpose,
  channelStatusClass,
  channelTypeClass,
  formatChannelStatus,
  formatChannelType,
  formatMacBalance,
  formatMacCycleMonth,
  macBalanceClass,
  macUsagePercent
} from "../lib/channelHelpers";
import { formatWhatsAppStatus, whatsappStatusBadgeClass } from "../lib/teamHelpers";

type Organization = { id: string; name: string };
type Channel = {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  external_id: string | null;
  status: string;
};
type ChannelUsageBoardItem = {
  channel_id: string;
  channel_name: string;
  organization_id: string;
  channel_type: string;
  channel_status: string;
  external_id: string | null;
  cycle_month: string;
  mac_count: number;
  campaign_messages_sent: number;
  whatsapp_status: string | null;
  whatsapp_phone: string | null;
  whatsapp_verified_name: string | null;
};
type ChannelUsageBoard = {
  cycle_month: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  over_mac_blocks: number;
  over_mac_price_per_100: number;
  estimated_over_mac_charge: number;
  channels: ChannelUsageBoardItem[];
};
type AssignmentRule = {
  id: string;
  channel_id: string | null;
  name: string;
  is_active: boolean;
};

export default function ChannelsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [type, setType] = useState("whatsapp");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const usageBoard = useQuery({
    queryKey: ["channels-usage-board"],
    queryFn: async () => (await api.get<ChannelUsageBoard>("/channels/usage-board")).data
  });
  const rulesQuery = useQuery({
    queryKey: ["assignment-rules"],
    queryFn: async () => (await api.get<AssignmentRule[]>("/assignments/rules")).data
  });

  const orgMap = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data]
  );

  const rulesByChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const rule of rulesQuery.data ?? []) {
      if (!rule.channel_id || !rule.is_active) continue;
      map.set(rule.channel_id, (map.get(rule.channel_id) ?? 0) + 1);
    }
    return map;
  }, [rulesQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (usageBoard.data?.channels ?? []).filter((item) => {
      if (typeFilter && item.channel_type !== typeFilter) return false;
      if (statusFilter && item.channel_status !== statusFilter) return false;
      if (!term) return true;
      const haystack = `${item.channel_name} ${item.channel_type} ${item.external_id ?? ""} ${orgMap.get(item.organization_id) ?? ""} ${item.whatsapp_phone ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [usageBoard.data?.channels, search, typeFilter, statusFilter, orgMap]);

  const stats = useMemo(() => {
    const rows = usageBoard.data?.channels ?? [];
    return {
      total: rows.length,
      whatsapp: rows.filter((item) => item.channel_type === "whatsapp").length,
      active: rows.filter((item) => item.channel_status === "active").length,
      connected: rows.filter((item) => item.whatsapp_status === "active").length
    };
  }, [usageBoard.data?.channels]);

  const board = usageBoard.data;

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await api.post<Channel>("/channels", {
        organization_id: organizationId,
        type,
        name,
        external_id: null
      });
      setName("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["channels"] }),
        client.invalidateQueries({ queryKey: ["channels-usage-board"] })
      ]);
      toastStore.getState().show("تمت إضافة القناة بنجاح", "success");
      if (type === "whatsapp") {
        navigate(`/whatsapp-connect?channel=${response.data.id}`);
      }
    } catch (error) {
      const detail = formatApiError(error);
      const msg =
        detail.includes("CHANNEL_LIMIT") || detail.includes("Channel limit")
          ? "وصلت للحد الأقصى من القنوات في خطتك. ترقِّ خطتك لإضافة المزيد."
          : detail.includes("NO_ACTIVE_SUBSCRIPTION") || detail.includes("subscription")
            ? "يلزم اشتراك نشط لإضافة قناة."
            : detail.includes("INVALID_ORGANIZATION") || detail.includes("Organization")
              ? "الفرع المحدد غير صالح."
              : detail.includes("MISSING_PERMISSION")
                ? "ليس لديك صلاحية إضافة قنوات."
                : detail;
      toastStore.getState().show(msg, "error");
    }
  }

  function renderWhatsAppCell(channel: ChannelUsageBoardItem) {
    if (channel.channel_type !== "whatsapp") return <span className="admin-chip admin-chip-muted">—</span>;
    if (!channel.whatsapp_phone) {
      return (
        <Link to={`/whatsapp-connect?channel=${channel.channel_id}`} className="admin-table-link">
          ربط WhatsApp
        </Link>
      );
    }
    const label = channel.whatsapp_verified_name || channel.whatsapp_phone;
    return (
      <div className="admin-cell-stack">
        <strong dir="ltr">{label}</strong>
        <small dir="ltr">{channel.whatsapp_phone}</small>
        {channel.whatsapp_status && (
          <span className={whatsappStatusBadgeClass(channel.whatsapp_status)}>
            {formatWhatsAppStatus(channel.whatsapp_status)}
          </span>
        )}
      </div>
    );
  }

  function renderTasksCell(channel: ChannelUsageBoardItem) {
    const rulesCount = rulesByChannel.get(channel.channel_id) ?? 0;
    return (
      <div className="admin-cell-stack">
        <span>{channelPurpose(channel.channel_type)}</span>
        <small>{rulesCount > 0 ? `${rulesCount} قاعدة توجيه نشطة` : "بدون قواعد توجيه"}</small>
        {channel.campaign_messages_sent > 0 && (
          <small>{channel.campaign_messages_sent.toLocaleString("ar")} رسالة حملة هذا الشهر</small>
        )}
      </div>
    );
  }

  function renderMacCell(channel: ChannelUsageBoardItem) {
    const included = board?.included_mac ?? 0;
    const accountUsed = board?.mac_count ?? 0;
    const percent = macUsagePercent(channel.mac_count, included);
    return (
      <div className="admin-cell-stack channel-mac-cell">
        <strong>{channel.mac_count.toLocaleString("ar")} MAC</strong>
        <small>مساهمة القناة · إجمالي الحساب {formatMacBalance(accountUsed, included)}</small>
        <div className="progress-track progress-track-compact">
          <div style={{ width: `${percent}%` }} />
        </div>
        <span className={macBalanceClass(Boolean(board?.is_over_mac), accountUsed, included)}>
          {board?.is_over_mac
            ? `Over MAC +${board.over_mac_count.toLocaleString("ar")}`
            : `${board?.mac_remaining.toLocaleString("ar") ?? 0} متبقٍ`}
        </span>
      </div>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>القنوات</h1>
        <p>حالة كل قناة، ربط WhatsApp Business، ورصيد MAC (Monthly Active Contacts) للدورة الحالية.</p>
      </header>

      {board && (
        <section className="admin-stats-row">
          <article className="admin-stat-card">
            <span>دورة MAC</span>
            <strong>{formatMacCycleMonth(board.cycle_month)}</strong>
          </article>
          <article className="admin-stat-card">
            <span>MAC المستخدم</span>
            <strong>{formatMacBalance(board.mac_count, board.included_mac)}</strong>
          </article>
          <article className="admin-stat-card">
            <span>الرصيد المتبقي</span>
            <strong>{board.is_over_mac ? "تجاوز الحد" : board.mac_remaining.toLocaleString("ar")}</strong>
          </article>
          <article className="admin-stat-card">
            <span>{board.is_over_mac ? "رسوم Over MAC التقديرية" : "حالة الرصيد"}</span>
            <strong>
              {board.is_over_mac
                ? `$${board.estimated_over_mac_charge.toFixed(0)}`
                : "ضمن الخطة"}
            </strong>
          </article>
        </section>
      )}

      <section className="admin-stats-row">
        <article className="admin-stat-card"><span>إجمالي القنوات</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card"><span>WhatsApp</span><strong>{stats.whatsapp}</strong></article>
        <article className="admin-stat-card"><span>قنوات نشطة</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card"><span>WhatsApp متصل</span><strong>{stats.connected}</strong></article>
      </section>

      {board?.is_over_mac && (
        <section className="card admin-note-card">
          <p>
            تجاوزت حد MAC المشمول في خطتك ({board.included_mac.toLocaleString("ar")} عميل نشط شهريًا).
            {" "}الزيادة: {board.over_mac_count.toLocaleString("ar")} MAC
            {" "}({board.over_mac_blocks} × 100) ·
            {" "}${board.over_mac_price_per_100.toFixed(0)} لكل 100 MAC إضافية ·
            {" "}تقدير: ${board.estimated_over_mac_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="card form-card admin-form-card">
        <h2>إضافة قناة</h2>
        <form className="inline-form" onSubmit={create}>
          <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required>
            <option value="">اختر الفرع</option>
            {(organizations.data ?? []).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
            <option value="email">Email</option>
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم القناة" required />
          <button type="submit">إضافة قناة</button>
        </form>
      </section>

      <section className="card admin-table-card">
        <div className="admin-table-header">
          <div>
            <h2>جدول القنوات</h2>
            <small>{filtered.length} قناة · MAC + حالة + رصيد</small>
          </div>
          <Link to="/assignments" className="admin-table-link">قواعد التوجيه ←</Link>
        </div>

        <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الفرع أو رقم WhatsApp" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">كل الأنواع</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
            <option value="email">Email</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="active">نشطة</option>
            <option value="pending">قيد الإعداد</option>
            <option value="disconnected">غير متصلة</option>
            <option value="suspended">موقوفة</option>
          </select>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-erp-table">
            <thead>
              <tr>
                <th>القناة</th>
                <th>الفرع</th>
                <th>النوع</th>
                <th>MAC / الرصيد</th>
                <th>المهام</th>
                <th>WhatsApp Business</th>
                <th>حالة القناة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {usageBoard.isLoading && (
                <tr><td colSpan={8} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!usageBoard.isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="admin-table-empty">لا توجد قنوات.</td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.channel_id}>
                  <td>
                    <div className="admin-cell-main">
                      <strong>{item.channel_name}</strong>
                      <small dir="ltr">{item.external_id ?? "—"}</small>
                    </div>
                  </td>
                  <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                  <td>
                    <span className={channelTypeClass(item.channel_type)}>{formatChannelType(item.channel_type)}</span>
                  </td>
                  <td>{renderMacCell(item)}</td>
                  <td>{renderTasksCell(item)}</td>
                  <td>{renderWhatsAppCell(item)}</td>
                  <td>
                    <span className={channelStatusClass(item.channel_status)}>{formatChannelStatus(item.channel_status)}</span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      {item.channel_type === "whatsapp" && (
                        <Link to={`/whatsapp-connect?channel=${item.channel_id}`} className="secondary-button">
                          {item.whatsapp_phone ? "إدارة الربط" : "ربط"}
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
