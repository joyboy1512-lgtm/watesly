import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type Channel = { id: string; name: string; type: string; organization_id: string; status: string };
type Organization = { id: string; name: string };
type MessengerAccount = {
  id: string;
  channel_id: string;
  channel_name?: string | null;
  organization_name?: string | null;
  page_id: string;
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

export default function MessengerConnectPage() {
  const [searchParams] = useSearchParams();
  const client = useQueryClient();
  const [channelId, setChannelId] = useState(searchParams.get("channel") ?? "");
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
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
    queryKey: ["messenger-accounts"],
    queryFn: async () => (await api.get<MessengerAccount[]>("/messenger/accounts")).data
  });

  const messengerChannels = useMemo(
    () => (channels.data ?? []).filter((item) => item.type === "messenger"),
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
      .get<{ callback_url: string }>("/messenger/webhook-callback")
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
      await api.post("/messenger/accounts", {
        channel_id: channelId,
        page_id: pageId.trim(),
        access_token: accessToken.trim()
      });
      setAccessToken("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["messenger-accounts"] }),
        client.invalidateQueries({ queryKey: ["channels"] }),
        client.invalidateQueries({ queryKey: ["channels-usage-board"] })
      ]);
      toastStore.getState().show("تم ربط Messenger.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error), "error");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect(id: string) {
    try {
      await api.post(`/messenger/accounts/${id}/disconnect`);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["messenger-accounts"] }),
        client.invalidateQueries({ queryKey: ["channels"] })
      ]);
      toastStore.getState().show("تم فصل Messenger.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error), "error");
    }
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">القنوات</p>
          <h1>ربط Facebook Messenger</h1>
          <p className="hint-text">اربط صفحة فيسبوك لاستقبال الرسائل والرد من الوارد.</p>
        </div>
        <Link to="/channels" className="secondary-button">
          العودة للقنوات
        </Link>
      </header>

      <section className="card stack-form">
        <h2>بيانات الربط</h2>
        <p className="hint-text">
          يلزم تفعيل الميزة <code dir="ltr">messenger_channel</code> من Developer إن كانت متوقفة.
        </p>
        {callbackUrl && (
          <p className="hint-text" dir="ltr">
            Webhook callback: {callbackUrl}
          </p>
        )}
        <form className="stack-form" onSubmit={(event) => void connect(event)}>
          <label className="field-label">
            <span>قناة Messenger</span>
            <select value={channelId} onChange={(event) => setChannelId(event.target.value)} required>
              <option value="">اختر قناة</option>
              {messengerChannels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {orgMap.get(item.organization_id) ?? "فرع"}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>Page ID</span>
            <input value={pageId} onChange={(event) => setPageId(event.target.value)} dir="ltr" required />
          </label>
          <label className="field-label">
            <span>Page Access Token</span>
            <input
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              dir="ltr"
              type="password"
              required
            />
          </label>
          <button type="submit" className="primary-button" disabled={connecting}>
            {connecting ? "جاري الربط…" : "ربط Messenger"}
          </button>
        </form>
      </section>

      <section className="card stack-form">
        <h2>الحسابات المرتبطة</h2>
        {(accounts.data ?? []).length === 0 ? (
          <p className="hint-text">لا حسابات Messenger بعد.</p>
        ) : (
          <div className="notes-list">
            {(accounts.data ?? []).map((item) => (
              <article key={item.id}>
                <p>
                  <strong>{item.page_name || item.page_id}</strong> · {statusLabel(item.status)}
                </p>
                <small dir="ltr">Page {item.page_id}</small>
                {item.meta_status_message && <p className="hint-text">{item.meta_status_message}</p>}
                {item.status === "active" && (
                  <button type="button" className="secondary-button" onClick={() => void disconnect(item.id)}>
                    فصل
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
