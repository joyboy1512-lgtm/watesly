import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type Channel = { id: string; name: string; type: string; organization_id: string; status: string };
type Organization = { id: string; name: string };
type InstagramAccount = {
  id: string;
  channel_id: string;
  channel_name?: string | null;
  organization_name?: string | null;
  page_id: string;
  ig_user_id: string;
  username?: string | null;
  page_name?: string | null;
  status: string;
  webhook_subscribed_at?: string | null;
  meta_status_message?: string | null;
};

function statusLabel(status: string) {
  switch (status) {
    case "active":
      return "متصل";
    case "disconnected":
      return "غير متصل";
    case "pending":
      return "قيد الإعداد";
    case "suspended":
      return "موقوف";
    default:
      return status;
  }
}

export default function InstagramConnectPage() {
  const [searchParams] = useSearchParams();
  const client = useQueryClient();
  const [channelId, setChannelId] = useState(searchParams.get("channel") ?? "");
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const accounts = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: async () => (await api.get<InstagramAccount[]>("/instagram/accounts")).data
  });

  const igChannels = useMemo(
    () => (channels.data ?? []).filter((item) => item.type === "instagram"),
    [channels.data]
  );
  const orgMap = useMemo(
    () => new Map((organizations.data ?? []).map((item) => [item.id, item.name])),
    [organizations.data]
  );

  useEffect(() => {
    const fromQuery = searchParams.get("channel");
    if (fromQuery) setChannelId(fromQuery);
  }, [searchParams]);

  useEffect(() => {
    void api
      .get<{ callback_url: string }>("/instagram/webhook-callback")
      .then((res) => setCallbackUrl(res.data.callback_url))
      .catch(() => setCallbackUrl(""));
  }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!channelId || !pageId.trim() || !accessToken.trim()) {
      toastStore.getState().show("أكمل القناة و Page ID والرمز.", "error");
      return;
    }
    setConnecting(true);
    try {
      await api.post("/instagram/accounts", {
        channel_id: channelId,
        page_id: pageId.trim(),
        access_token: accessToken.trim(),
        ig_user_id: igUserId.trim() || null
      });
      setAccessToken("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["instagram-accounts"] }),
        client.invalidateQueries({ queryKey: ["channels"] }),
        client.invalidateQueries({ queryKey: ["channels-usage-board"] })
      ]);
      toastStore.getState().show("تم ربط Instagram بنجاح.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error) || "تعذر ربط Instagram.", "error");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect(accountId: string) {
    if (!window.confirm("فصل ربط Instagram؟ الرسائل السابقة تبقى في الوارد.")) return;
    try {
      await api.post(`/instagram/accounts/${accountId}/disconnect`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["instagram-accounts"] }),
        client.invalidateQueries({ queryKey: ["channels"] })
      ]);
      toastStore.getState().show("تم فصل Instagram.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error) || "تعذر الفصل.", "error");
    }
  }

  return (
    <main className="page channels-page">
      <header className="page-header channels-hero">
        <div>
          <span className="channels-eyebrow">Instagram Messaging</span>
          <h1>ربط Instagram</h1>
          <p>
            اربط حساب Instagram Business المرتبط بصفحة فيسبوك لاستقبال رسائل Direct والرد عليها من صندوق الوارد.
          </p>
        </div>
        <div className="channels-hero-actions">
          <Link to="/channels" className="secondary-button">القنوات</Link>
          <Link to="/inbox" className="secondary-button">الوارد</Link>
        </div>
      </header>

      <section className="card admin-note-card">
        <p>
          المتطلبات: حساب Instagram احترافي (Business/Creator) مربوط بصفحة Facebook، وصلاحيات
          {" "}<code dir="ltr">pages_messaging</code> و <code dir="ltr">instagram_manage_messages</code>،
          و Page Access Token طويل الأمد. أضف Webhook Callback في Meta App:
          {" "}
          <strong dir="ltr">{callbackUrl || "https://api.watesly.com/api/v1/instagram/webhook"}</strong>
          {" "}مع حقول <code dir="ltr">messages</code>.
        </p>
      </section>

      <article className="card form-card admin-form-card channels-form-card">
        <div className="assignments-form-head">
          <div>
            <h2>ربط حساب جديد</h2>
            <small>أدخل Page ID و Page Access Token — يتم اكتشاف Instagram تلقائياً</small>
          </div>
        </div>
        <form className="assignments-setup-form" onSubmit={connect}>
          <div className="assignments-field-grid">
            <label className="assignments-field">
              <span>قناة Instagram</span>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                <option value="">اختر القناة</option>
                {igChannels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {orgMap.get(item.organization_id) ?? "فرع"}
                  </option>
                ))}
              </select>
            </label>
            <label className="assignments-field">
              <span>Facebook Page ID</span>
              <input
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder="1234567890"
                dir="ltr"
                required
              />
            </label>
          </div>
          <label className="assignments-field">
            <span>Page Access Token</span>
            <textarea
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAG..."
              dir="ltr"
              rows={3}
              required
            />
          </label>
          <label className="assignments-field">
            <span>Instagram Business Account ID (اختياري)</span>
            <input
              value={igUserId}
              onChange={(e) => setIgUserId(e.target.value)}
              placeholder="يُكتشف تلقائياً من الصفحة"
              dir="ltr"
            />
          </label>
          {igChannels.length === 0 && (
            <p className="hint-text">
              لا توجد قناة Instagram بعد. أنشئها من{" "}
              <Link to="/channels">صفحة القنوات</Link> بنوع Instagram أولاً.
            </p>
          )}
          <button
            className="assignments-primary-btn assignments-form-submit"
            type="submit"
            disabled={connecting || igChannels.length === 0}
          >
            {connecting ? "جاري الربط…" : "ربط Instagram"}
          </button>
        </form>
      </article>

      <section className="card admin-table-card channels-table-card">
        <div className="admin-table-header assignments-table-title">
          <div>
            <h2>حسابات Instagram المرتبطة</h2>
            <small>{(accounts.data ?? []).length} حساب</small>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-erp-table channels-erp-table channels-erp-table-compact">
            <thead>
              <tr>
                <th>الحساب</th>
                <th>القناة</th>
                <th>Page ID</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {accounts.isLoading && (
                <tr><td colSpan={5} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!accounts.isLoading && (accounts.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="admin-table-empty">لا توجد حسابات Instagram مربوطة بعد.</td></tr>
              )}
              {(accounts.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="channels-name-cell">
                      <strong>{item.username ? `@${item.username}` : item.page_name || item.ig_user_id}</strong>
                      <small dir="ltr">{item.ig_user_id}</small>
                    </div>
                  </td>
                  <td>{item.channel_name ?? "—"}</td>
                  <td dir="ltr">{item.page_id}</td>
                  <td>
                    <span className={item.status === "active" ? "admin-status admin-status-active" : "admin-chip admin-chip-muted"}>
                      {statusLabel(item.status)}
                    </span>
                    {item.meta_status_message && (
                      <small className="hint-text" style={{ display: "block" }}>{item.meta_status_message}</small>
                    )}
                  </td>
                  <td>
                    <div className="admin-actions channels-row-actions">
                      <Link to="/inbox" className="secondary-button">الوارد</Link>
                      {item.status === "active" && (
                        <button type="button" className="secondary-button channels-archive-btn" onClick={() => void disconnect(item.id)}>
                          فصل
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
