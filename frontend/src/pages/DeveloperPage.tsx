import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  request_count: number;
  created_at: string | null;
};

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string | null;
};

type DeliveryRow = {
  id: string;
  event_type: string;
  status: string;
  response_code: number | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string | null;
};

type DevTab = "keys" | "webhooks" | "deliveries" | "docs" | "marketplace";

const SCOPE_OPTIONS = [
  "contacts:read",
  "contacts:write",
  "messages:send",
  "campaigns:read",
  "crm:read",
  "crm:write"
];

export default function DeveloperPage() {
  const { t } = useTranslation();
  const tabs: { id: DevTab; label: string }[] = [
    { id: "keys", label: t("developer.tabKeys") },
    { id: "webhooks", label: t("developer.tabWebhooks") },
    { id: "deliveries", label: t("developer.tabDeliveries") },
    { id: "docs", label: t("developer.tabDocs") },
    { id: "marketplace", label: t("developer.tabMarketplace") }
  ];
  const client = useQueryClient();
  const [tab, setTab] = useState<DevTab>("keys");
  const [keyName, setKeyName] = useState("Production API");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["message.received", "deal.won"]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(SCOPE_OPTIONS);

  const overview = useQuery({
    queryKey: ["developer-overview"],
    queryFn: async () => (await api.get("/platform/developer/overview")).data
  });
  const keys = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => (await api.get<ApiKeyRow[]>("/platform/developer/api-keys")).data
  });
  const webhooks = useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => (await api.get<WebhookRow[]>("/platform/developer/webhooks")).data
  });
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: async () => (await api.get<DeliveryRow[]>("/platform/developer/deliveries")).data,
    enabled: tab === "deliveries"
  });
  const docs = useQuery({
    queryKey: ["developer-docs"],
    queryFn: async () => (await api.get("/platform/developer/docs")).data,
    enabled: tab === "docs"
  });
  const events = useQuery({
    queryKey: ["webhook-events"],
    queryFn: async () => (await api.get<{ events: string[] }>("/platform/developer/webhook-events")).data
  });
  const marketplace = useQuery({
    queryKey: ["marketplace"],
    queryFn: async () => (await api.get("/platform/marketplace")).data,
    enabled: tab === "marketplace"
  });

  const eventOptions = events.data?.events ?? ["message.received", "deal.won"];

  async function createKey(event: FormEvent) {
    event.preventDefault();
    const result = await api.post("/platform/developer/api-keys", { name: keyName, scopes: selectedScopes });
    setNewKey(result.data.key);
    toastStore.getState().show("تم إنشاء المفتاح — احفظه الآن.", "success");
    await client.invalidateQueries({ queryKey: ["api-keys"] });
    await client.invalidateQueries({ queryKey: ["developer-overview"] });
  }

  async function revokeKey(id: string) {
    await api.delete(`/platform/developer/api-keys/${id}`);
    toastStore.getState().show("تم إلغاء المفتاح.", "success");
    await client.invalidateQueries({ queryKey: ["api-keys"] });
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault();
    const result = await api.post("/platform/developer/webhooks", { url: webhookUrl, events: selectedEvents });
    setWebhookSecret(result.data.secret);
    toastStore.getState().show("تم إنشاء Webhook.", "success");
    await client.invalidateQueries({ queryKey: ["webhooks"] });
  }

  async function testWebhook(id: string) {
    const result = await api.post(`/platform/developer/webhooks/${id}/test`);
    toastStore.getState().show(
      result.data.status === "success" ? "اختبار ناجح." : `فشل: ${result.data.error_message || result.data.status}`,
      result.data.status === "success" ? "success" : "error"
    );
    await client.invalidateQueries({ queryKey: ["webhook-deliveries"] });
  }

  async function deleteWebhook(id: string) {
    await api.delete(`/platform/developer/webhooks/${id}`);
    await client.invalidateQueries({ queryKey: ["webhooks"] });
  }

  const curlExample = useMemo(
    () =>
      `curl -H "Authorization: Bearer mw_YOUR_KEY" \\
  ${window.location.origin.replace("5173", "8000")}/api/v1/external/contacts`,
    []
  );

  return (
    <main className="page developer-page">
      <header className="developer-header">
        <div>
          <p className="developer-eyebrow">{t("eyebrow.developerPlatform")}</p>
          <h1>{t("pages.developer")}</h1>
          <p>REST API خارجي، webhooks موقّعة، rate limits، وتكاملات Marketplace.</p>
        </div>
        <Link to="/analytics" className="secondary-button">التحليلات</Link>
      </header>

      <section className="developer-stats-grid">
        <article className="metric-card"><span>API Keys</span><strong>{overview.data?.api_keys ?? "…"}</strong></article>
        <article className="metric-card"><span>Webhooks</span><strong>{overview.data?.webhooks ?? "…"}</strong></article>
        <article className="metric-card"><span>طلبات API</span><strong>{overview.data?.total_api_requests ?? "…"}</strong></article>
        <article className="metric-card"><span>Rate limit</span><strong>{overview.data?.rate_limit_per_minute ?? 100}/د</strong></article>
      </section>

      <section className="card developer-tabs">
        {tabs.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? "developer-tab active" : "developer-tab"} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </section>

      {newKey && (
        <section className="card developer-alert">
          <strong>احفظ مفتاح API الآن (لن يظهر مجدداً):</strong>
          <code dir="ltr">{newKey}</code>
        </section>
      )}
      {webhookSecret && (
        <section className="card developer-alert">
          <strong>Webhook secret:</strong>
          <code dir="ltr">{webhookSecret}</code>
        </section>
      )}

      {tab === "keys" && (
        <section className="card">
          <h2 className="section-title-sm">إنشاء API Key</h2>
          <form className="developer-form" onSubmit={createKey}>
            <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="اسم المفتاح" />
            <div className="developer-scope-grid">
              {SCOPE_OPTIONS.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={(e) =>
                      setSelectedScopes((current) =>
                        e.target.checked ? [...current, scope] : current.filter((s) => s !== scope)
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
            <button type="submit" className="whatsapp-button">إنشاء مفتاح</button>
          </form>
          <div className="table-card">
            <table>
              <thead><tr><th>الاسم</th><th>Prefix</th><th>Scopes</th><th>طلبات</th><th>آخر استخدام</th><th></th></tr></thead>
              <tbody>
                {(keys.data ?? []).map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td dir="ltr">{key.key_prefix}…</td>
                    <td>{key.scopes.join(", ")}</td>
                    <td>{key.request_count}</td>
                    <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString("ar") : "—"}</td>
                    <td><button type="button" className="secondary-button" onClick={() => void revokeKey(key.id)}>إلغاء</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "webhooks" && (
        <section className="card">
          <h2 className="section-title-sm">Webhook جديد</h2>
          <form className="developer-form" onSubmit={createWebhook}>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhooks/watesly" dir="ltr" />
            <div className="developer-scope-grid">
              {eventOptions.map((event) => (
                <label key={event}>
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={(e) =>
                      setSelectedEvents((current) =>
                        e.target.checked ? [...current, event] : current.filter((s) => s !== event)
                      )
                    }
                  />
                  {event}
                </label>
              ))}
            </div>
            <button type="submit" className="whatsapp-button">إضافة Webhook</button>
          </form>
          <div className="table-card">
            <table>
              <thead><tr><th>URL</th><th>Events</th><th>الحالة</th><th>إجراءات</th></tr></thead>
              <tbody>
                {(webhooks.data ?? []).map((hook) => (
                  <tr key={hook.id}>
                    <td dir="ltr">{hook.url}</td>
                    <td>{hook.events.join(", ")}</td>
                    <td>{hook.is_active ? "نشط" : "متوقف"}</td>
                    <td className="inline-actions">
                      <button type="button" className="secondary-button" onClick={() => void testWebhook(hook.id)}>اختبار</button>
                      <button type="button" className="secondary-button" onClick={() => void deleteWebhook(hook.id)}>حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "deliveries" && (
        <section className="card table-card">
          <h2 className="section-title-sm">سجل إرسال Webhooks</h2>
          <table>
            <thead><tr><th>Event</th><th>Status</th><th>HTTP</th><th>ms</th><th>التاريخ</th></tr></thead>
            <tbody>
              {(deliveries.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.event_type}</td>
                  <td>{row.status}</td>
                  <td>{row.response_code ?? "—"}</td>
                  <td>{row.duration_ms ?? "—"}</td>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString("ar") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "docs" && (
        <section className="card developer-docs">
          <h2 className="section-title-sm">REST API</h2>
          <p><strong>Base URL:</strong> <code dir="ltr">{overview.data?.external_base_url ?? "/api/v1/external"}</code></p>
          <p><strong>Auth:</strong> {docs.data?.authentication ?? "Bearer mw_..."}</p>
          <pre dir="ltr" className="developer-code">{curlExample}</pre>
          <h3>Endpoints</h3>
          <ul>
            {(docs.data?.endpoints ?? []).map((item: { method: string; path: string; scope: string }) => (
              <li key={item.path}><code dir="ltr">{item.method} {item.path}</code> — {item.scope}</li>
            ))}
          </ul>
          <p>Webhook signature: <code>{docs.data?.webhook_signature}</code></p>
          <a href={`${window.location.origin.replace("5173", "8000")}/docs`} target="_blank" rel="noreferrer">OpenAPI Swagger ↗</a>
        </section>
      )}

      {tab === "marketplace" && (
        <section className="card marketplace-grid">
          {(marketplace.data ?? []).map((item: { id: string; name: string; category: string; description: string | null; status: string }) => (
            <article key={item.id} className="marketplace-card card">
              <h3>{item.name}</h3>
              <span className="hint-text">{item.category}</span>
              <p>{item.description}</p>
              <span className="developer-badge">{item.status}</span>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
