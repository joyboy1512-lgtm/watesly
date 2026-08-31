import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { hasNavPermission } from "../lib/navPermissions";
import { toastStore } from "../stores/toast";
import {
  CHANNEL_TYPE_OPTIONS,
  type BasicChannel,
  type ChannelRow,
  type ChannelUsageBoard,
  channelCapabilities,
  channelSetupState,
  channelStatusClass,
  channelTypeClass,
  channelTypeHint,
  channelsForBranch,
  formatChannelStatus,
  formatChannelType,
  formatMacBalance,
  formatMacCycleMonth,
  macBalanceClass,
  mergeChannelRows
} from "../lib/channelHelpers";
import { formatWhatsAppStatus, whatsappStatusBadgeClass } from "../lib/teamHelpers";

type Organization = { id: string; name: string };

export default function ChannelsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [branchFilter, setBranchFilter] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [type, setType] = useState("whatsapp");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [macFilter, setMacFilter] = useState("");
  const [creating, setCreating] = useState(false);

  const profile = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => (await api.get<{ permissions?: string[] }>("/auth/me")).data
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<BasicChannel[]>("/channels")).data
  });
  const usageBoard = useQuery({
    queryKey: ["channels-usage-board"],
    queryFn: async () => (await api.get<ChannelUsageBoard>("/channels/usage-board")).data,
    retry: 1
  });

  const canManage = hasNavPermission(profile.data?.permissions, "channels.manage");
  const canManageBilling = hasNavPermission(profile.data?.permissions, "billing.manage");

  const orgMap = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data]
  );

  const allRows = useMemo(
    () => mergeChannelRows(channelsQuery.data ?? [], usageBoard.data),
    [channelsQuery.data, usageBoard.data]
  );

  const visibleRows = useMemo(
    () => channelsForBranch(allRows, branchFilter),
    [allRows, branchFilter]
  );

  const board = usageBoard.data;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visibleRows.filter((item) => {
      if (typeFilter && item.channel_type !== typeFilter) return false;
      if (statusFilter && item.channel_status !== statusFilter) return false;
      if (macFilter === "active" && item.mac_count <= 0) return false;
      if (macFilter === "idle" && item.mac_count > 0) return false;
      if (macFilter === "over" && !board?.is_over_mac) return false;
      if (!term) return true;
      const haystack = `${item.channel_name} ${item.channel_type} ${item.external_id ?? ""} ${orgMap.get(item.organization_id) ?? ""} ${item.whatsapp_phone ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [visibleRows, search, typeFilter, statusFilter, macFilter, orgMap, board?.is_over_mac]);

  const stats = useMemo(() => {
    return {
      total: visibleRows.length,
      whatsapp: visibleRows.filter((item) => item.channel_type === "whatsapp").length,
      active: visibleRows.filter((item) => item.channel_status === "active").length,
      connected: visibleRows.filter((item) => item.whatsapp_status === "active").length
    };
  }, [visibleRows]);

  const setup = channelSetupState(visibleRows);
  const isLoading = channelsQuery.isLoading || (usageBoard.isLoading && !channelsQuery.data);
  const loadError = channelsQuery.isError && usageBoard.isError;
  const boardPartial = usageBoard.isError && (channelsQuery.data?.length ?? 0) > 0;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!canManage) {
      toastStore.getState().show("ليس لديك صلاحية إضافة قنوات.", "error");
      return;
    }
    setCreating(true);
    try {
      const response = await api.post<BasicChannel>("/channels", {
        organization_id: organizationId,
        type,
        name: name.trim(),
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
    } finally {
      setCreating(false);
    }
  }

  async function archiveChannel(channel: ChannelRow) {
    if (!canManage) {
      toastStore.getState().show("ليس لديك صلاحية أرشفة القنوات.", "error");
      return;
    }
    const confirmed = window.confirm(
      `أرشفة القناة "${channel.channel_name}"؟\nستختفي من القائمة ويُفصل ربط WhatsApp إن وُجد. المحادثات والسجلات تبقى محفوظة.`
    );
    if (!confirmed) return;
    try {
      await api.post(`/channels/${channel.channel_id}/archive`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["channels"] }),
        client.invalidateQueries({ queryKey: ["channels-usage-board"] }),
        client.invalidateQueries({ queryKey: ["whatsapp-accounts"] })
      ]);
      toastStore.getState().show("تمت أرشفة القناة.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error) || "تعذر أرشفة القناة.", "error");
    }
  }

  function renderWhatsAppCell(channel: ChannelRow) {
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
      <div className="channels-inline-cell">
        <strong dir="ltr">{label}</strong>
        {channel.whatsapp_status && (
          <span className={whatsappStatusBadgeClass(channel.whatsapp_status)}>
            {formatWhatsAppStatus(channel.whatsapp_status)}
          </span>
        )}
      </div>
    );
  }

  function renderMacCell(channel: ChannelRow) {
    if (!board) {
      return <span className="admin-chip admin-chip-muted">{channel.mac_count.toLocaleString("ar")} MAC</span>;
    }
    return (
      <div className="channels-inline-cell">
        <strong>{formatMacBalance(channel.mac_count, channel.included_mac)}</strong>
        <span className={macBalanceClass(channel.is_over_mac, channel.mac_count, channel.included_mac)}>
          {channel.is_over_mac ? `+${channel.over_mac_count.toLocaleString("ar")}` : "ضمن الحصة"}
        </span>
      </div>
    );
  }

  return (
    <main className="page channels-page">
      <header className="page-header channels-hero">
        <div>
          <span className="channels-eyebrow">إدارة القنوات</span>
          <h1>القنوات</h1>
          <p>أنشئ قنوات التواصل لكل فرع، اربط WhatsApp Business، وتابع MAC والاستخدام الشهري.</p>
        </div>
        <div className="channels-hero-actions">
          <Link to="/assignments" className="secondary-button">قواعد التوزيع</Link>
          <Link to="/billing" className="secondary-button">الفوترة و MAC</Link>
        </div>
      </header>

      <section className="billing-per-channel-banner ready card">
        <div>
          <strong>فوترة MAC مستقلة لكل قناة</strong>
          <small>
            {canManageBilling
              ? "عدّل فوترة MAC لكل قناة من صفحة الفوترة — الجدول هنا للعرض السريع فقط."
              : "كل قناة لها اشتراك وحصة MAC وOver MAC منفصلة. التفاصيل في صفحة الفوترة."}
          </small>
        </div>
        <span className="billing-per-channel-badge">مستقل</span>
      </section>

      {board && (
        <section className="admin-stats-row admin-stats-row-brand">
          <article className="admin-stat-card admin-stat-card-brand">
            <span>دورة MAC</span>
            <strong>{formatMacCycleMonth(board.cycle_month)}</strong>
          </article>
          <article className="admin-stat-card admin-stat-card-brand">
            <span>MAC المجمّع</span>
            <strong>{formatMacBalance(board.mac_count, board.included_mac)}</strong>
          </article>
          <article className="admin-stat-card admin-stat-card-brand">
            <span>الرصيد المتبقي</span>
            <strong>{board.is_over_mac ? "تجاوز الحد" : board.mac_remaining.toLocaleString("ar")}</strong>
          </article>
          <article className="admin-stat-card admin-stat-card-brand">
            <span>{board.is_over_mac ? "رسوم Over MAC التقديرية" : "حالة الرصيد"}</span>
            <strong>
              {board.is_over_mac ? `$${board.estimated_over_mac_charge.toFixed(0)}` : "ضمن الخطة"}
            </strong>
          </article>
        </section>
      )}

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي القنوات</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>WhatsApp</span><strong>{stats.whatsapp}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>قنوات نشطة</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>WhatsApp متصل</span><strong>{stats.connected}</strong></article>
      </section>

      <section className={`channels-setup-banner ${setup.ready ? "ready" : "pending"}`}>
        <div>
          <strong>{setup.title}</strong>
          <small>{setup.detail}</small>
        </div>
        <span className="channels-setup-status">{setup.statusLabel}</span>
      </section>

      {boardPartial && (
        <section className="card admin-note-card">
          <p>تعذر تحميل تفاصيل MAC — القنوات معروضة من القائمة الأساسية. جرّب تحديث الصفحة.</p>
        </section>
      )}

      {board?.is_over_mac && (
        <section className="card admin-note-card">
          <p>
            إجمالي تجاوز MAC عبر القنوات: {board.over_mac_count.toLocaleString("ar")} MAC
            {" "}({board.over_mac_blocks} × 100) ·
            {" "}تقدير: ${board.estimated_over_mac_charge.toFixed(2)}
          </p>
        </section>
      )}

      <section className="channels-types-grid">
        {CHANNEL_TYPE_OPTIONS.map((item) => (
          <article key={item} className="channels-type-card">
            <div className="channels-type-head">
              <span className={channelTypeClass(item)}>{formatChannelType(item)}</span>
            </div>
            <p>{channelTypeHint(item)}</p>
            <div className="admin-chip-row">
              {channelCapabilities(item).map((cap) => (
                <span key={cap} className="admin-chip admin-chip-muted">{cap}</span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="card assignments-filter-card channels-filter-card">
        <div className="assignments-filter-bar">
          <div>
            <strong>تصفية حسب الفرع</strong>
            <small>اعرض قنوات فرع محدد</small>
          </div>
          <select
            value={branchFilter}
            onChange={(e) => {
              const value = e.target.value;
              setBranchFilter(value);
              if (value) setOrganizationId(value);
            }}
          >
            <option value="">كل الأفرع</option>
            {(organizations.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
      </section>

      {canManage && (
        <article className="card form-card admin-form-card channels-form-card">
          <div className="assignments-form-head">
            <div>
              <h2>إضافة قناة</h2>
              <small>اختر الفرع والنوع — بعد WhatsApp سيتم توجيهك لصفحة الربط</small>
            </div>
            <span className="assignments-form-step">+</span>
          </div>
          <form className="assignments-setup-form" onSubmit={create}>
            <div className="assignments-field-grid">
              <label className="assignments-field">
                <span>الفرع</span>
                <select
                  value={organizationId}
                  onChange={(e) => setOrganizationId(e.target.value)}
                  required
                >
                  <option value="">اختر الفرع</option>
                  {(organizations.data ?? []).map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </label>
              <label className="assignments-field">
                <span>نوع القناة</span>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {CHANNEL_TYPE_OPTIONS.map((item) => (
                    <option key={item} value={item}>{formatChannelType(item)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="assignments-field">
              <span>اسم القناة</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: WhatsApp المبيعات"
                required
              />
            </label>
            {type !== "whatsapp" && (
              <p className="hint-text">{channelTypeHint(type)}</p>
            )}
            <button
              className="assignments-primary-btn assignments-form-submit"
              type="submit"
              disabled={creating || !organizationId || !name.trim()}
            >
              {creating ? "جاري الإضافة…" : "إضافة قناة"}
            </button>
          </form>
        </article>
      )}

      <section className="card admin-table-card channels-table-card">
        <div className="admin-table-header assignments-table-title">
          <div>
            <h2>جدول القنوات</h2>
            <small>{filtered.length} قناة · MAC · WhatsApp · إجراءات</small>
          </div>
        </div>

        <div className="channels-table-toolbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الفرع أو رقم WhatsApp"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">كل الأنواع</option>
            {CHANNEL_TYPE_OPTIONS.map((item) => (
              <option key={item} value={item}>{formatChannelType(item)}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="active">نشطة</option>
            <option value="pending">قيد الإعداد</option>
            <option value="disconnected">غير متصلة</option>
            <option value="suspended">موقوفة</option>
          </select>
          <select value={macFilter} onChange={(e) => setMacFilter(e.target.value)}>
            <option value="">كل MAC</option>
            <option value="active">قنوات لها MAC</option>
            <option value="idle">بدون MAC</option>
            <option value="over">عند تجاوز الرصيد</option>
          </select>
          {(channelsQuery.isError || usageBoard.isError) && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void channelsQuery.refetch();
                void usageBoard.refetch();
              }}
            >
              إعادة المحاولة
            </button>
          )}
        </div>

        <div className="admin-table-wrap">
          <table className="admin-erp-table channels-erp-table channels-erp-table-compact">
            <thead>
              <tr>
                <th>القناة</th>
                <th>الفرع</th>
                <th>النوع</th>
                <th>MAC</th>
                <th>WhatsApp Business</th>
                <th>حالة القناة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {loadError && (
                <tr>
                  <td colSpan={7} className="admin-table-empty">
                    تعذر تحميل القنوات. تحقق من الصلاحيات أو اتصال الخادم.
                  </td>
                </tr>
              )}
              {!isLoading && !loadError && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="admin-table-empty">
                    {visibleRows.length === 0
                      ? "لا توجد قنوات بعد. أنشئ قناة من النموذج أعلاه."
                      : "لا توجد نتائج مطابقة للبحث أو التصفية."}
                  </td>
                </tr>
              )}
              {filtered.map((item) => (
                <tr key={item.channel_id}>
                  <td>
                    <div className="admin-cell-main channels-name-cell">
                      <strong>{item.channel_name}</strong>
                      {item.whatsapp_phone && <small dir="ltr">{item.whatsapp_phone}</small>}
                    </div>
                  </td>
                  <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                  <td>
                    <span className={channelTypeClass(item.channel_type)}>{formatChannelType(item.channel_type)}</span>
                  </td>
                  <td>{renderMacCell(item)}</td>
                  <td>{renderWhatsAppCell(item)}</td>
                  <td>
                    <span className={channelStatusClass(item.channel_status)}>{formatChannelStatus(item.channel_status)}</span>
                  </td>
                  <td>
                    <div className="admin-actions channels-row-actions">
                      <Link to={`/channels/${item.channel_id}/mac`} className="secondary-button">
                        MAC
                      </Link>
                      {item.channel_type === "whatsapp" && canManage && (
                        <Link to={`/whatsapp-connect?channel=${item.channel_id}`} className="secondary-button">
                          {item.whatsapp_phone ? "إدارة الربط" : "ربط"}
                        </Link>
                      )}
                      <Link to="/inbox" className="secondary-button">الوارد</Link>
                      {canManage && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void archiveChannel(item)}
                        >
                          أرشفة
                        </button>
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
