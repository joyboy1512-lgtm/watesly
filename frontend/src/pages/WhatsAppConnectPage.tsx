import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  EmbeddedSignupConfig,
  EmbeddedSignupSession,
  QUALITY_LABELS,
  launchEmbeddedSignup,
  listenEmbeddedSignup,
  loadFacebookSdk,
  qualityClass
} from "../lib/metaEmbeddedSignup";
import { buildWaMeLink, qrCodeUrl } from "../lib/serviceWindow";
import { toastStore } from "../stores/toast";

type Channel = { id: string; name: string; type: string };
type Account = {
  id: string;
  display_phone_number: string;
  verified_name: string | null;
  status: string;
  connection_method?: string;
  quality_rating?: string | null;
  messaging_limit_tier?: string | null;
  messaging_limit?: number | null;
  health_synced_at?: string | null;
  meta_catalog_id?: string | null;
  commerce_enabled?: boolean;
  catalog_synced_at?: string | null;
};

export default function WhatsAppConnectPage() {
  const client = useQueryClient();
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
  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<Account[]>("/whatsapp/accounts")).data
  });
  const embeddedConfig = useQuery({
    queryKey: ["embedded-signup-config"],
    queryFn: async () => (await api.get<EmbeddedSignupConfig>("/whatsapp/embedded-signup/config")).data
  });

  const whatsappChannels = (channels.data ?? []).filter((item) => item.type === "whatsapp");
  const entryAccount = useMemo(
    () => (accounts.data ?? []).find((item) => item.id === entryAccountId) ?? (accounts.data ?? [])[0] ?? null,
    [accounts.data, entryAccountId]
  );
  const waMeLink = entryAccount
    ? buildWaMeLink(entryAccount.display_phone_number, prefilledMessage)
    : "";

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
      toastStore.getState().show("تم ربط الحساب عبر Embedded Signup.", "success");
    } catch {
      toastStore.getState().show("تعذر إكمال Embedded Signup.", "error");
    } finally {
      setLaunchingEmbedded(false);
    }
  }

  async function copyLink() {
    if (!waMeLink) return;
    try {
      await navigator.clipboard.writeText(waMeLink);
      toastStore.getState().show("تم نسخ الرابط.", "success");
    } catch {
      toastStore.getState().show("تعذر نسخ الرابط.", "error");
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
      toastStore.getState().show("تم ربط حساب WhatsApp.", "success");
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
      toastStore.getState().show("تمت مزامنة جودة الحساب وحدود الإرسال.", "success");
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
      if (result.data.valid) {
        toastStore.getState().show("رمز Meta صالح.", "success");
      } else {
        toastStore.getState().show("رمز Meta غير صالح — حدّثه من Meta Developer.", "error");
      }
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
      toastStore.getState().show("تعذر تحديث الرمز — تحقق من صلاحيته.", "error");
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

  return (
    <main className="page whatsapp-connect-page">
      <header className="page-header catalog-hero">
        <div>
          <span className="eyebrow whatsapp-eyebrow">WhatsApp Business</span>
          <h1>ربط WhatsApp</h1>
          <p>Embedded Signup من Meta أو ربط يدوي — مع Quality Rating وحدود الإرسال.</p>
        </div>
      </header>

      <section className="card whatsapp-list-card">
        <div className="whatsapp-list-header">
          <h2 className="section-title">الحسابات المربوطة</h2>
          <p className="hint-text">{accounts.data?.length ?? 0} حساب</p>
        </div>
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>الاسم المعتمد</th>
                <th>رقم WhatsApp</th>
                <th>الجودة</th>
                <th>حد الإرسال</th>
                <th>الربط</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {(accounts.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.verified_name || "—"}</td>
                  <td dir="ltr">{item.display_phone_number}</td>
                  <td>
                    <span className={`quality-badge ${qualityClass(item.quality_rating)}`}>
                      {QUALITY_LABELS[(item.quality_rating ?? "UNKNOWN").toUpperCase()] ?? "—"}
                    </span>
                  </td>
                  <td>
                    {item.messaging_limit
                      ? `${item.messaging_limit.toLocaleString("ar")}/24س`
                      : item.messaging_limit_tier ?? "—"}
                  </td>
                  <td>{item.connection_method === "embedded" ? "Embedded" : "يدوي"}</td>
                  <td><span className={`tag-chip ${item.status === "disconnected" ? "tag-warning" : ""}`}>{item.status}</span></td>
                  <td>
                    <div className="inline-actions compact">
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={syncingId === item.id}
                        onClick={() => void syncHealth(item.id)}
                      >
                        {syncingId === item.id ? "…" : "مزامنة"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => void checkTokenStatus(item.id)}
                      >
                        Token
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!accounts.data?.length && (
            <p className="hint-text">لا يوجد حساب WhatsApp مربوط بعد.</p>
          )}
        </div>
      </section>

      {(accounts.data ?? []).length > 0 && (
        <section className="card whatsapp-token-card">
          <h2 className="section-title">رمز Meta — التحقق والتحديث</h2>
          <p className="hint-text">
            استخدم System User Token طويل الأمد من Meta Business. إذا ظهرت الحالة <strong>disconnected</strong>، حدّث الرمز هنا.
          </p>
          <div className="whatsapp-token-grid">
            {(accounts.data ?? []).map((item) => (
              <article key={item.id} className="whatsapp-token-item">
                <strong>{item.verified_name || item.display_phone_number}</strong>
                <p className="hint-text">
                  {tokenStatus[item.id]
                    ? tokenStatus[item.id].valid
                      ? "✓ الرمز صالح"
                      : `✗ ${tokenStatus[item.id].error ?? "الرمز غير صالح"}`
                    : "اضغط Token للتحقق"}
                </p>
                <label className="field-label">
                  <span>Access Token جديد</span>
                  <input
                    type="password"
                    dir="ltr"
                    value={tokenDrafts[item.id] ?? ""}
                    onChange={(e) =>
                      setTokenDrafts((current) => ({ ...current, [item.id]: e.target.value }))
                    }
                    placeholder="EAA..."
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={updatingTokenId === item.id}
                  onClick={() => void updateToken(item.id)}
                >
                  {updatingTokenId === item.id ? "جاري التحديث…" : "تحديث الرمز"}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {(accounts.data ?? []).length > 0 && (
        <section className="card whatsapp-commerce-card">
          <h2 className="section-title">WhatsApp Commerce — Meta Catalog</h2>
          <p className="hint-text">
            اربط Catalog ID من Meta Commerce Manager لتفعيل رسائل المنتج التفاعلية (single / multi product).
          </p>
          <div className="whatsapp-commerce-grid">
            {(accounts.data ?? []).map((item) => (
              <article key={item.id} className="whatsapp-commerce-item">
                <strong>{item.verified_name || item.display_phone_number}</strong>
                <label className="field-label">
                  <span>Meta Catalog ID</span>
                  <input
                    dir="ltr"
                    value={commerceDrafts[item.id]?.meta_catalog_id ?? ""}
                    onChange={(e) =>
                      setCommerceDrafts((current) => ({
                        ...current,
                        [item.id]: {
                          meta_catalog_id: e.target.value,
                          commerce_enabled: current[item.id]?.commerce_enabled ?? false
                        }
                      }))
                    }
                    placeholder="1234567890"
                  />
                </label>
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={commerceDrafts[item.id]?.commerce_enabled ?? false}
                    onChange={(e) =>
                      setCommerceDrafts((current) => ({
                        ...current,
                        [item.id]: {
                          meta_catalog_id: current[item.id]?.meta_catalog_id ?? "",
                          commerce_enabled: e.target.checked
                        }
                      }))
                    }
                  />
                  <span>تفعيل Commerce</span>
                </label>
                <button type="button" className="secondary-button" onClick={() => void saveCommerce(item.id)}>
                  حفظ
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {embeddedConfig.data?.enabled ? (
        <section className="card whatsapp-embedded-card">
          <h2 className="section-title">Embedded Signup — ربط بضغطة (Meta)</h2>
          <p className="hint-text">كما في respond.io: سجّل الدخول عبر Meta Business واختر الرقم مباشرة.</p>
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
            {embeddedSession && (
              <p className="hint-text">
                ✓ WABA: {embeddedSession.waba_id} · Phone ID: {embeddedSession.phone_number_id}
              </p>
            )}
            <button
              type="button"
              className="whatsapp-button"
              disabled={!embeddedChannelId || launchingEmbedded}
              onClick={() => void launchEmbedded()}
            >
              {launchingEmbedded ? "جاري الربط…" : "بدء Embedded Signup"}
            </button>
          </div>
        </section>
      ) : (
        <section className="card whatsapp-embedded-card">
          <h2 className="section-title">Embedded Signup</h2>
          <p className="hint-text">
            لتفعيل الربط بضغطة واحدة، أضف في `.env`: `META_APP_ID` و `META_EMBEDDED_SIGNUP_CONFIG_ID` من Meta Developer.
          </p>
        </section>
      )}

      <section className="card whatsapp-entry-card">
        <h2 className="section-title">نقاط الدخول — wa.me و QR</h2>
        <p className="hint-text">
          أنشئ رابط محادثة أو QR للموقع، الإعلانات، أو البطاقات.
        </p>
        {!accounts.data?.length && (
          <p className="hint-text">اربط حساب WhatsApp أولاً لإنشاء روابط الدخول.</p>
        )}
        {Boolean(accounts.data?.length) && (
          <div className="entry-points-grid">
            <div className="entry-point-card">
              <label className="field-label">
                <span>الحساب</span>
                <select
                  value={entryAccount?.id ?? ""}
                  onChange={(e) => setEntryAccountId(e.target.value)}
                >
                  {(accounts.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.verified_name || item.display_phone_number}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                <span>رسالة مسبقة (اختياري)</span>
                <textarea
                  value={prefilledMessage}
                  onChange={(e) => setPrefilledMessage(e.target.value)}
                  rows={3}
                />
              </label>
              <label className="field-label">
                <span>رابط wa.me</span>
                <input value={waMeLink} readOnly dir="ltr" />
              </label>
              <div className="inline-actions">
                <button type="button" className="secondary-button" onClick={() => void copyLink()}>
                  نسخ الرابط
                </button>
                <a className="secondary-button" href={waMeLink} target="_blank" rel="noreferrer">
                  تجربة
                </a>
              </div>
            </div>
            <div className="entry-point-card">
              <h3 className="section-title-sm">رمز QR</h3>
              <p className="hint-text">اطبعه أو ضعه في موقعك — العميل يمسح ويفتح WhatsApp مباشرة.</p>
              {waMeLink && (
                <img src={qrCodeUrl(waMeLink)} alt="QR Code للمحادثة على WhatsApp" />
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card whatsapp-manage-card">
        <h2 className="section-title">ربط يدوي</h2>
        <p className="hint-text">
          من Meta Developer → WhatsApp → API Setup: WABA ID، Phone Number ID، و Access Token.
        </p>

        <form className="whatsapp-panel stack-form" onSubmit={connect}>
          <label className="field-label">
            <span>قناة WhatsApp</span>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
              <option value="">اختر القناة</option>
              {whatsappChannels.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>

          <div className="whatsapp-section">
            <h3 className="section-title-sm">بيانات Meta</h3>
            <div className="whatsapp-fields-row">
              <label className="field-label">
                <span>WABA ID</span>
                <input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="123456789012345"
                  dir="ltr"
                  required
                />
              </label>
              <label className="field-label">
                <span>Phone Number ID</span>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="987654321098765"
                  dir="ltr"
                  required
                />
              </label>
            </div>
          </div>

          <div className="whatsapp-section">
            <h3 className="section-title-sm">بيانات الرقم</h3>
            <div className="whatsapp-fields-row">
              <label className="field-label">
                <span>رقم WhatsApp (للعرض)</span>
                <input
                  value={displayPhoneNumber}
                  onChange={(e) => setDisplayPhoneNumber(e.target.value)}
                  placeholder="+96550000000"
                  dir="ltr"
                  required
                />
              </label>
              <label className="field-label">
                <span>الاسم المعتمد (اختياري)</span>
                <input
                  value={verifiedName}
                  onChange={(e) => setVerifiedName(e.target.value)}
                  placeholder="اسم الشركة"
                />
              </label>
            </div>
          </div>

          <div className="whatsapp-section whatsapp-token-section">
            <h3 className="section-title-sm">رمز الوصول</h3>
            <label className="field-label">
              <span>Access Token</span>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAAxxxxxxxx..."
                dir="ltr"
                rows={4}
                required
              />
            </label>
            <p className="hint-text">لا تشارك الرمز — يُستخدم لإرسال واستقبال الرسائل عبر Meta.</p>
          </div>

          <button type="submit" className="whatsapp-button" disabled={!whatsappChannels.length}>
            ربط الحساب
          </button>
          {!whatsappChannels.length && (
            <p className="hint-text">أنشئ قناة WhatsApp أولاً من صفحة القنوات.</p>
          )}
        </form>
      </section>
    </main>
  );
}
