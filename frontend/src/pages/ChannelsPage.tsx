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
  formatChannelType
} from "../lib/channelHelpers";
import { formatWhatsAppStatus, whatsappStatusBadgeClass, workspaceDisplayName } from "../lib/teamHelpers";

type Organization = { id: string; name: string };
type Channel = {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  external_id: string | null;
  status: string;
};
type WhatsAppAccount = {
  id: string;
  channel_id: string;
  display_phone_number: string;
  verified_name: string | null;
  status: string;
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
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data
  });
  const rulesQuery = useQuery({
    queryKey: ["assignment-rules"],
    queryFn: async () => (await api.get<AssignmentRule[]>("/assignments/rules")).data
  });

  const orgMap = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data]
  );

  const waByChannel = useMemo(() => {
    const map = new Map<string, WhatsAppAccount>();
    for (const account of whatsappAccounts.data ?? []) {
      map.set(account.channel_id, account);
    }
    return map;
  }, [whatsappAccounts.data]);

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
    return (channels.data ?? []).filter((item) => {
      if (typeFilter && item.type !== typeFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (!term) return true;
      const wa = waByChannel.get(item.id);
      const haystack = `${item.name} ${item.type} ${item.external_id ?? ""} ${orgMap.get(item.organization_id) ?? ""} ${wa?.display_phone_number ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [channels.data, search, typeFilter, statusFilter, orgMap, waByChannel]);

  const stats = useMemo(() => {
    const rows = channels.data ?? [];
    return {
      total: rows.length,
      whatsapp: rows.filter((item) => item.type === "whatsapp").length,
      active: rows.filter((item) => item.status === "active").length,
      connected: (whatsappAccounts.data ?? []).filter((item) => item.status === "active").length
    };
  }, [channels.data, whatsappAccounts.data]);

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
      await client.invalidateQueries({ queryKey: ["channels"] });
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

  function renderWhatsAppCell(channel: Channel) {
    if (channel.type !== "whatsapp") return <span className="admin-chip admin-chip-muted">—</span>;
    const account = waByChannel.get(channel.id);
    if (!account) {
      return (
        <Link to={`/whatsapp-connect?channel=${channel.id}`} className="admin-table-link">
          ربط WhatsApp
        </Link>
      );
    }
    return (
      <div className="admin-cell-stack">
        <strong dir="ltr">{workspaceDisplayName(account)}</strong>
        <span className={whatsappStatusBadgeClass(account.status)}>{formatWhatsAppStatus(account.status)}</span>
      </div>
    );
  }

  function renderTasksCell(channel: Channel) {
    const rulesCount = rulesByChannel.get(channel.id) ?? 0;
    return (
      <div className="admin-cell-stack">
        <span>{channelPurpose(channel.type)}</span>
        <small>{rulesCount > 0 ? `${rulesCount} قاعدة توجيه نشطة` : "بدون قواعد توجيه"}</small>
      </div>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>القنوات</h1>
        <p>جدول منظم يوضح مهام كل قناة وفرعها وحالة ربط WhatsApp Business.</p>
      </header>

      <section className="admin-stats-row">
        <article className="admin-stat-card"><span>إجمالي القنوات</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card"><span>WhatsApp</span><strong>{stats.whatsapp}</strong></article>
        <article className="admin-stat-card"><span>قنوات نشطة</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card"><span>WhatsApp متصل</span><strong>{stats.connected}</strong></article>
      </section>

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
            <small>{filtered.length} قناة · صف لكل قناة</small>
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
                <th>المهام والاستخدام</th>
                <th>WhatsApp Business</th>
                <th>حالة القناة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {channels.isLoading && (
                <tr><td colSpan={7} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!channels.isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="admin-table-empty">لا توجد قنوات.</td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="admin-cell-main">
                      <strong>{item.name}</strong>
                      <small dir="ltr">{item.external_id ?? "—"}</small>
                    </div>
                  </td>
                  <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                  <td>
                    <span className={channelTypeClass(item.type)}>{formatChannelType(item.type)}</span>
                  </td>
                  <td>{renderTasksCell(item)}</td>
                  <td>{renderWhatsAppCell(item)}</td>
                  <td>
                    <span className={channelStatusClass(item.status)}>{formatChannelStatus(item.status)}</span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      {item.type === "whatsapp" && (
                        <Link to={`/whatsapp-connect?channel=${item.id}`} className="secondary-button">
                          {waByChannel.has(item.id) ? "إدارة الربط" : "ربط"}
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
