import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  EmbeddedSignupConfig,
  EmbeddedSignupSession,
  launchEmbeddedSignup,
  listenEmbeddedSignup,
  loadFacebookSdk
} from "../lib/metaEmbeddedSignup";
import { buildWaMeLink, qrCodeUrl } from "../lib/serviceWindow";
import { toastStore } from "../stores/toast";
import {
  commerceStatusClass,
  connectionMethodClass,
  formatCommerceSummary,
  formatConnectionMethod,
  formatHealthSynced,
  formatMessagingLimit,
  formatQualityRating,
  formatWhatsAppStatus,
  qualityBadgeClass,
  truncateMetaId,
  whatsappStatusBadgeClass,
  type WhatsAppAccountRow
} from "../lib/whatsappHelpers";

type Channel = { id: string; name: string; type: string; organization_id: string; status: string };
type Organization = { id: string; name: string };

type TableRow = {
  key: string;
  channel: Channel;
  channelName: string;
  organizationName: string;
  account: WhatsAppAccountRow | null;
};

type PageTab = "accounts" | "connect" | "entry";

export default function WhatsAppConnectPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<PageTab>("accounts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [channelId, setChannelId] = useState("");
  const [embeddedChannelId, setEmbeddedChannelId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [verifiedName, setVerifiedName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [entryAccountId, setEntryAccountId] = useState("");
  const [prefilledMessage, setPrefilledMessage] = useState("مرحباً، أريد الاستفسار عن…");
  const [embeddedSession, setEmbeddedSession] = useState<EmbeddedSignupSession | null>(null);
  const [oauthCode, setOauthCode] = useState<string | null>(null);
  const [launchingEmbedded, setLaunchingEmbedded] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [tokenStatus, setTokenStatus] = useState<Record<string, { valid: boolean; error?: string | null }>>({});
  const [updatingTokenId, setUpdatingTokenId] = useState<string | null>(null);
  const [commerceDrafts, setCommerceDrafts] = useState<Record<string, { meta_catalog_id: string; commerce_enabled: boolean }>>({});

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });
  const embeddedConfig = useQuery({
    queryKey: ["embedded-signup-config"],
    queryFn: async () => (await api.get<EmbeddedSignupConfig>("/whatsapp/embedded-signup/config")).data
  });

  const orgMap = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data]
  );
  const accountByChannel = useMemo(() => {
    const map = new Map<string, WhatsAppAccountRow>();
    for (const item of accounts.data ?? []) {
      map.set(item.channel_id, item);
    }
    return map;
  }, [accounts.data]);

  const whatsappChannels = useMemo(
    () => (channels.data ?? []).filter((item) => item.type === "whatsapp"),
    [channels.data]
  );

  const tableRows = useMemo<TableRow[]>(() => {
    return whatsappChannels.map((channel) => {
      const account = accountByChannel.get(channel.id) ?? null;
      return {
        key: account?.id ?? channel.id,
        channel,
        channelName: account?.channel_name ?? channel.name,
        organizationName: account?.organization_name ?? orgMap.get(channel.organization_id) ?? "—",
        account
      };
    });
  }, [whatsappChannels, accountByChannel, orgMap]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tableRows.filter((row) => {
      const status = row.account?.status ?? "unlinked";
      if (statusFilter === "unlinked" && row.account) return false;
      if (statusFilter && statusFilter !== "unlinked" && status !== statusFilter) return false;
      if (!term) return true;
      const haystack = [
        row.channelName,
        row.organizationName,
        row.account?.verified_name,
        row.account?.display_phone_number,
        row.account?.waba_id,
        row.account?.phone_number_id
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [tableRows, search, statusFilter]);

  const stats = useMemo(() => {
    const linked = accounts.data ?? [];
    return {
      channels: whatsappChannels.length,
      linked: linked.length,
      active: linked.filter((item) => item.status === "active").length,
      disconnected: linked.filter((item) => item.status === "disconnected").length,
      embedded: linked.filter((item) => item.connection_method === "embedded").length
    };
  }, [accounts.data, whatsappChannels.length]);

  const entryAccount = useMemo(
    () => (accounts.data ?? []).find((item) => item.id === entryAccountId) ?? (accounts.data ?? [])[0] ?? null,
    [accounts.data, entryAccountId]
  );
  const embeddedChannelAccount = useMemo(
    () => (embeddedChannelId ? accountByChannel.get(embeddedChannelId) ?? null : null),
    [embeddedChannelId, accountByChannel]
  );
  const manualChannelAccount = useMemo(
    () => (channelId ? accountByChannel.get(channelId) ?? null : null),
    [channelId, accountByChannel]
  );
  const waMeLink = entryAccount
    ? buildWaMeLink(entryAccount.display_phone_number, prefilledMessage)
    : "";

  useEffect(() => {
    const channelFromQuery = searchParams.get("channel");
    if (!channelFromQuery) return;
    setEmbeddedChannelId(channelFromQuery);
    setChannelId(channelFromQuery);
    setActiveTab("connect");
  }, [searchParams]);

  useEffect(() => {
    const cfg = embeddedConfig.data;
    if (!cfg?.enabled || !cfg.app_id) return;
    void loadFacebookSdk(cfg.app_id, cfg.api_version).catch(() => {
      toastStore.getState().show("تعذر تحميل Facebook SDK.", "error");
    });
  }, [embeddedConfig.data]);

  useEffect(() => {
    return listenEmbeddedSignup((session) => {
      setEmbeddedSession(session);
      toastStore.getState().show("تم استلام بيانات الرقم من Meta.", "success");
    });
  }, []);

  useEffect(() => {
    if (!oauthCode || !embeddedSession || !embeddedChannelId) return;
    void completeEmbedded(oauthCode, embeddedSession);
  }, [oauthCode, embeddedSession, embeddedChannelId]);

  useEffect(() => {
    const next: Record<string, { meta_catalog_id: string; commerce_enabled: boolean }> = {};
    for (const item of accounts.data ?? []) {
      next[item.id] = {
        meta_catalog_id: item.meta_catalog_id ?? "",
        commerce_enabled: Boolean(item.commerce_enabled)
      };
    }
    setCommerceDrafts(next);
  }, [accounts.data]);

  async function completeEmbedded(code: string, session: EmbeddedSignupSession) {
    setLaunchingEmbedded(true);
    try {
      await api.post("/whatsapp/accounts/embedded", {
        channel_id: embeddedChannelId,
        waba_id: session.waba_id,
        phone_number_id: session.phone_number_id,
        code
      });
      setEmbeddedSession(null);
      setOauthCode(null);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      toastStore.getState().show(
        embeddedChannelAccount ? "تم استبدال رقم WhatsApp على هذه القناة." : "تم ربط الحساب عبر Embedded Signup.",
        "success"
      );
      setActiveTab("accounts");
    } catch {
      toastStore.getState().show("تعذر إكمال Embedded Signup.", "error");
    } finally {
      setLaunchingEmbedded(false);
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    try {
      await api.post("/whatsapp/accounts", {
        channel_id: channelId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        display_phone_number: displayPhoneNumber,
        verified_name: verifiedName || null,
        access_token: accessToken
      });
      setWabaId("");
      setPhoneNumberId("");
      setDisplayPhoneNumber("");
      setVerifiedName("");
      setAccessToken("");
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      toastStore.getState().show(
        manualChannelAccount ? "تم استبدال رقم WhatsApp على هذه القناة." : "تم ربط حساب WhatsApp.",
        "success"
      );
      setActiveTab("accounts");
    } catch {
      toastStore.getState().show("تعذر الربط. تحقق من البيانات ورمز الوصول.", "error");
    }
  }

  async function launchEmbedded() {
    const cfg = embeddedConfig.data;
    if (!cfg?.enabled || !cfg.config_id || !embeddedChannelId) {
      toastStore.getState().show("اختر القناة وتأكد من إعداد Meta App ID و Config ID.", "error");
      return;
    }
    setLaunchingEmbedded(true);
    setOauthCode(null);
    setEmbeddedSession(null);
    try {
      await loadFacebookSdk(cfg.app_id!, cfg.api_version);
      const code = await launchEmbeddedSignup(cfg.config_id);
      if (!code) {
        toastStore.getState().show("أُلغي Embedded Signup.", "error");
        setLaunchingEmbedded(false);
        return;
      }
      setOauthCode(code);
      setLaunchingEmbedded(false);
      toastStore.getState().show("أكمل اختيار الرقم في نافذة Meta…", "success");
    } catch {
      toastStore.getState().show("تعذر Embedded Signup.", "error");
      setLaunchingEmbedded(false);
    }
  }

  async function syncHealth(accountId: string) {
    setSyncingId(accountId);
    try {
      await api.post(`/whatsapp/accounts/${accountId}/sync-health`);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      toastStore.getState().show("تمت مزامنة الجودة وحدود الإرسال.", "success");
    } catch {
      toastStore.getState().show("تعذر المزامنة — تحقق من رمز Meta.", "error");
    } finally {
      setSyncingId(null);
    }
  }

  async function checkTokenStatus(accountId: string) {
    try {
      const result = await api.get<{ valid: boolean; error?: string | null }>(`/whatsapp/accounts/${accountId}/token-status`);
      setTokenStatus((current) => ({ ...current, [accountId]: result.data }));
      toastStore.getState().show(
        result.data.valid ? "رمز Meta صالح." : "رمز Meta غير صالح — حدّثه.",
        result.data.valid ? "success" : "error"
      );
    } catch {
      toastStore.getState().show("تعذر التحقق من رمز Meta.", "error");
    }
  }

  async function updateToken(accountId: string) {
    const nextToken = tokenDrafts[accountId]?.trim();
    if (!nextToken) {
      toastStore.getState().show("أدخل رمز الوصول الجديد.", "error");
      return;
    }
    setUpdatingTokenId(accountId);
    try {
      await api.patch(`/whatsapp/accounts/${accountId}/access-token`, { access_token: nextToken });
      setTokenDrafts((current) => ({ ...current, [accountId]: "" }));
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      await checkTokenStatus(accountId);
      toastStore.getState().show("تم تحديث رمز Meta.", "success");
    } catch {
      toastStore.getState().show("تعذر تحديث الرمز.", "error");
    } finally {
      setUpdatingTokenId(null);
    }
  }

  async function saveCommerce(accountId: string) {
    const draft = commerceDrafts[accountId];
    if (!draft) return;
    try {
      await api.patch(`/whatsapp/accounts/${accountId}/commerce`, draft);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      toastStore.getState().show("تم حفظ إعدادات Commerce.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ Commerce.", "error");
    }
  }

  async function disconnectAccount(accountId: string) {
    try {
      await api.post(`/whatsapp/accounts/${accountId}/disconnect`);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      toastStore.getState().show("تم فصل الحساب.", "success");
      if (expandedId === accountId) setExpandedId(null);
    } catch {
      toastStore.getState().show("تعذر فصل الحساب.", "error");
    }
  }

  function openConnectForChannel(channelIdValue: string) {
    setChannelId(channelIdValue);
    setEmbeddedChannelId(channelIdValue);
    setActiveTab("connect");
    setSearchParams({ channel: channelIdValue });
  }

  function renderReplaceWarning(account: WhatsAppAccountRow) {
    return (
      <div className="whatsapp-replace-warning" role="alert">
        <strong>هذه القناة مربوطة بالفعل.</strong>
        <p className="hint-text">
          ربط رقم جديد سيستبدل{" "}
          <span dir="ltr">{account.display_phone_number}</span>
          {" "}— الرقم القديم يبقى في Meta ولن يُحذف.
        </p>
      </div>
    );
  }

  function renderTokenBadge(accountId: string) {
    const status = tokenStatus[accountId];
    if (!status) return <span className="admin-chip admin-chip-muted">غير مفحوص</span>;
    return (
      <span className={status.valid ? "admin-status admin-status-active" : "admin-status admin-status-danger"}>
        {status.valid ? "Token ✓" : "Token ✗"}
      </span>
    );
  }

  function renderExpandedPanel(account: WhatsAppAccountRow) {
    return (
      <tr className="whatsapp-expand-row">
        <td colSpan={10}>
          <div className="whatsapp-expand-grid">
            <article className="whatsapp-expand-panel">
              <h3>رمز Meta</h3>
              <p className="hint-text">
                {tokenStatus[account.id]?.valid
                  ? "الرمز صالح حالياً."
                  : tokenStatus[account.id]?.error ?? "تحقق من الرمز أو حدّثه عند ظهور disconnected."}
              </p>
              <input
                type="password"
                dir="ltr"
                value={tokenDrafts[account.id] ?? ""}
                onChange={(e) =>
                  setTokenDrafts((current) => ({ ...current, [account.id]: e.target.value }))
                }
                placeholder="EAA..."
              />
              <div className="admin-actions">
                <button type="button" className="secondary-button" onClick={() => void checkTokenStatus(account.id)}>
                  فحص Token
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={updatingTokenId === account.id}
                  onClick={() => void updateToken(account.id)}
                >
                  {updatingTokenId === account.id ? "جاري الحفظ…" : "تحديث الرمز"}
                </button>
              </div>
            </article>
            <article className="whatsapp-expand-panel">
              <h3>WhatsApp Commerce</h3>
              <label className="field-label">
                <span>Meta Catalog ID</span>
                <input
                  dir="ltr"
                  value={commerceDrafts[account.id]?.meta_catalog_id ?? ""}
                  onChange={(e) =>
                    setCommerceDrafts((current) => ({
                      ...current,
                      [account.id]: {
                        meta_catalog_id: e.target.value,
                        commerce_enabled: current[account.id]?.commerce_enabled ?? false
                      }
                    }))
                  }
                  placeholder="1234567890"
                />
              </label>
              <label className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={commerceDrafts[account.id]?.commerce_enabled ?? false}
                  onChange={(e) =>
                    setCommerceDrafts((current) => ({
                      ...current,
                      [account.id]: {
                        meta_catalog_id: current[account.id]?.meta_catalog_id ?? "",
                        commerce_enabled: e.target.checked
                      }
                    }))
                  }
                />
                <span>تفعيل Commerce</span>
              </label>
              <button type="button" className="secondary-button" onClick={() => void saveCommerce(account.id)}>
                حفظ Commerce
              </button>
            </article>
            <article className="whatsapp-expand-panel">
              <h3>Meta IDs</h3>
              <div className="whatsapp-meta-id-list">
                <div><span>WABA ID</span><code dir="ltr">{account.waba_id}</code></div>
                <div><span>Phone Number ID</span><code dir="ltr">{account.phone_number_id}</code></div>
              </div>
              {account.catalog_synced_at && (
                <p className="hint-text">Catalog sync: {formatHealthSynced(account.catalog_synced_at)}</p>
              )}
            </article>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <main className="page whatsapp-connect-page">
      <header className="page-header">
        <div>
          <span className="eyebrow whatsapp-eyebrow">WhatsApp Business API</span>
          <h1>WhatsApp Business</h1>
          <p>جدول موحّد لكل قناة وحساب مربوط — الجودة، الحدود، Token، Commerce، والإجراءات في صف واحد.</p>
        </div>
        <Link to="/channels" className="secondary-button">إدارة القنوات ←</Link>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>قنوات WhatsApp</span><strong>{stats.channels}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>حسابات مربوطة</span><strong>{stats.linked}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>متصل</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>Embedded</span><strong>{stats.embedded}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>غير متصل</span><strong>{stats.disconnected}</strong></article>
      </section>

      <div className="whatsapp-page-tabs">
        <button type="button" className={activeTab === "accounts" ? "whatsapp-tab active" : "whatsapp-tab"} onClick={() => setActiveTab("accounts")}>
          الحسابات المربوطة
        </button>
        <button type="button" className={activeTab === "connect" ? "whatsapp-tab active" : "whatsapp-tab"} onClick={() => setActiveTab("connect")}>
          ربط حساب جديد
        </button>
        <button type="button" className={activeTab === "entry" ? "whatsapp-tab active" : "whatsapp-tab"} onClick={() => setActiveTab("entry")}>
          نقاط الدخول wa.me
        </button>
      </div>

      {activeTab === "accounts" && (
        <section className="card admin-table-card">
          <div className="admin-table-header">
            <div>
              <h2>جدول حسابات WhatsApp</h2>
              <small>{filteredRows.length} صف · قناة أو حساب</small>
            </div>
          </div>

          <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالقناة أو الرقم أو WABA…"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">كل الحالات</option>
              <option value="active">متصل</option>
              <option value="disconnected">غير متصل</option>
              <option value="pending">قيد الربط</option>
              <option value="unlinked">غير مربوط</option>
            </select>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-erp-table whatsapp-erp-table">
              <thead>
                <tr>
                  <th>القناة / الفرع</th>
                  <th>WhatsApp Business</th>
                  <th>Meta IDs</th>
                  <th>الجودة / الحد</th>
                  <th>Commerce</th>
                  <th>Token</th>
                  <th>آخر مزامنة</th>
                  <th>الربط</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {accounts.isLoading && (
                  <tr><td colSpan={10} className="admin-table-empty">جاري التحميل…</td></tr>
                )}
                {!accounts.isLoading && filteredRows.length === 0 && (
                  <tr><td colSpan={10} className="admin-table-empty">لا توجد قنوات WhatsApp.</td></tr>
                )}
                {filteredRows.map((row) => {
                  const account = row.account;
                  if (!account) {
                    return (
                      <tr key={row.key}>
                        <td>
                          <div className="admin-cell-main">
                            <strong>{row.channelName}</strong>
                            <small>{row.organizationName}</small>
                          </div>
                        </td>
                        <td colSpan={7}><span className="admin-chip admin-chip-muted">لم يُربَط بعد</span></td>
                        <td><span className="admin-status admin-status-pending">غير مربوط</span></td>
                        <td>
                          <button type="button" className="whatsapp-button compact" onClick={() => openConnectForChannel(row.channel.id)}>
                            ربط
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  const isExpanded = expandedId === account.id;
                  return (
                    <Fragment key={account.id}>
                      <tr>
                        <td>
                          <div className="admin-cell-main">
                            <strong>{row.channelName}</strong>
                            <small>{row.organizationName}</small>
                          </div>
                        </td>
                        <td>
                          <div className="admin-cell-stack">
                            <strong>{account.verified_name || "—"}</strong>
                            <small dir="ltr">{account.display_phone_number}</small>
                          </div>
                        </td>
                        <td>
                          <div className="admin-cell-stack" dir="ltr">
                            <small title={account.waba_id}>WABA {truncateMetaId(account.waba_id)}</small>
                            <small title={account.phone_number_id}>Phone {truncateMetaId(account.phone_number_id)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="admin-cell-stack">
                            <span className={qualityBadgeClass(account.quality_rating)}>
                              {formatQualityRating(account.quality_rating)}
                            </span>
                            <small>{formatMessagingLimit(account)}</small>
                          </div>
                        </td>
                        <td>
                          <span className={commerceStatusClass(account)}>{formatCommerceSummary(account)}</span>
                        </td>
                        <td>{renderTokenBadge(account.id)}</td>
                        <td><small>{formatHealthSynced(account.health_synced_at)}</small></td>
                        <td>
                          <span className={connectionMethodClass(account.connection_method)}>
                            {formatConnectionMethod(account.connection_method)}
                          </span>
                        </td>
                        <td>
                          <span className={whatsappStatusBadgeClass(account.status)}>
                            {formatWhatsAppStatus(account.status)}
                          </span>
                        </td>
                        <td>
                          <div className="admin-actions whatsapp-row-actions">
                            <button
                              type="button"
                              className="secondary-button compact"
                              disabled={syncingId === account.id}
                              onClick={() => void syncHealth(account.id)}
                            >
                              {syncingId === account.id ? "…" : "مزامنة"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => setExpandedId(isExpanded ? null : account.id)}
                            >
                              {isExpanded ? "إغلاق" : "إعدادات"}
                            </button>
                            <Link to={`/inbox`} className="secondary-button compact">Inbox</Link>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => openConnectForChannel(row.channel.id)}
                            >
                              استبدال
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact danger-text"
                              onClick={() => void disconnectAccount(account.id)}
                            >
                              فصل
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && renderExpandedPanel(account)}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "connect" && (
        <div className="whatsapp-connect-grid">
          {embeddedConfig.data?.enabled ? (
            <section className="card admin-form-card">
              <h2>Embedded Signup — Meta</h2>
              <p className="hint-text">ربط بضغطة واحدة عبر Meta Business (مثل respond.io).</p>
              <div className="stack-form">
                <label className="field-label">
                  <span>قناة WhatsApp</span>
                  <select value={embeddedChannelId} onChange={(e) => setEmbeddedChannelId(e.target.value)}>
                    <option value="">اختر القناة</option>
                    {whatsappChannels.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                {embeddedChannelAccount && renderReplaceWarning(embeddedChannelAccount)}
                {embeddedSession && (
                  <p className="hint-text">
                    WABA: {embeddedSession.waba_id} · Phone ID: {embeddedSession.phone_number_id}
                  </p>
                )}
                <button
                  type="button"
                  className="whatsapp-button"
                  disabled={!embeddedChannelId || launchingEmbedded}
                  onClick={() => void launchEmbedded()}
                >
                  {launchingEmbedded
                    ? "جاري الربط…"
                    : embeddedChannelAccount
                      ? "استبدال الرقم عبر Embedded Signup"
                      : "بدء Embedded Signup"}
                </button>
              </div>
            </section>
          ) : (
            <section className="card admin-form-card">
              <h2>Embedded Signup</h2>
              <p className="hint-text">
                لتفعيل الربط بضغطة، أضف `META_APP_ID` و `META_EMBEDDED_SIGNUP_CONFIG_ID` في `.env`.
              </p>
            </section>
          )}

          <section className="card admin-form-card">
            <h2>ربط يدوي</h2>
            <p className="hint-text">WABA ID، Phone Number ID، ورمز System User من Meta Developer.</p>
            <form className="stack-form" onSubmit={connect}>
              <label className="field-label">
                <span>قناة WhatsApp</span>
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                  <option value="">اختر القناة</option>
                  {whatsappChannels.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              {manualChannelAccount && renderReplaceWarning(manualChannelAccount)}
              <div className="whatsapp-fields-row">
                <label className="field-label">
                  <span>WABA ID</span>
                  <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} dir="ltr" required />
                </label>
                <label className="field-label">
                  <span>Phone Number ID</span>
                  <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} dir="ltr" required />
                </label>
              </div>
              <div className="whatsapp-fields-row">
                <label className="field-label">
                  <span>رقم WhatsApp</span>
                  <input value={displayPhoneNumber} onChange={(e) => setDisplayPhoneNumber(e.target.value)} dir="ltr" required />
                </label>
                <label className="field-label">
                  <span>الاسم المعتمد</span>
                  <input value={verifiedName} onChange={(e) => setVerifiedName(e.target.value)} />
                </label>
              </div>
              <label className="field-label">
                <span>Access Token</span>
                <textarea value={accessToken} onChange={(e) => setAccessToken(e.target.value)} dir="ltr" rows={4} required />
              </label>
              <button type="submit" className="whatsapp-button" disabled={!whatsappChannels.length}>
                {manualChannelAccount ? "استبدال الرقم" : "ربط الحساب"}
              </button>
            </form>
          </section>
        </div>
      )}

      {activeTab === "entry" && (
        <section className="card admin-form-card">
          <h2>نقاط الدخول — wa.me و QR</h2>
          {!accounts.data?.length && (
            <p className="hint-text">اربط حساب WhatsApp أولاً من تبويب «ربط حساب جديد».</p>
          )}
          {Boolean(accounts.data?.length) && (
            <div className="entry-points-grid">
              <div className="entry-point-card">
                <label className="field-label">
                  <span>الحساب</span>
                  <select value={entryAccount?.id ?? ""} onChange={(e) => setEntryAccountId(e.target.value)}>
                    {(accounts.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.verified_name || item.display_phone_number}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  <span>رسالة مسبقة</span>
                  <textarea value={prefilledMessage} onChange={(e) => setPrefilledMessage(e.target.value)} rows={3} />
                </label>
                <label className="field-label">
                  <span>رابط wa.me</span>
                  <input value={waMeLink} readOnly dir="ltr" />
                </label>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void navigator.clipboard.writeText(waMeLink).then(() => {
                        toastStore.getState().show("تم نسخ الرابط.", "success");
                      });
                    }}
                  >
                    نسخ
                  </button>
                  <a className="secondary-button" href={waMeLink} target="_blank" rel="noreferrer">تجربة</a>
                </div>
              </div>
              <div className="entry-point-card">
                <h3>رمز QR</h3>
                {waMeLink && <img src={qrCodeUrl(waMeLink)} alt="QR Code WhatsApp" className="whatsapp-qr-image" />}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
