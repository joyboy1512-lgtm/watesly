import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { uploadFile } from "../lib/uploads";
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
  formatCommerceShort,
  formatCommerceSummary,
  formatConnectionMethod,
  formatHealthSynced,
  formatMetaHealthDetails,
  formatMetaHealthLabel,
  formatMetaHealthShort,
  formatMessagingLimit,
  formatQualityRating,
  formatWhatsAppStatus,
  getMetaHealthSeverity,
  metaHealthBadgeClass,
  qualityBadgeClass,
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

const WHATSAPP_ACCOUNT_TABLE_COLS = 3;

type AccountPanelTab = "details" | "settings";

type CommerceReadiness = {
  commerce_enabled: boolean;
  meta_catalog_id: string | null;
  account_ready: boolean;
  token_valid: boolean | null;
  token_scopes: string[];
  has_catalog_management: boolean;
  token_error: string | null;
  products_active: number;
};

export default function WhatsAppConnectPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<PageTab>("accounts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [panelState, setPanelState] = useState<{ accountId: string; tab: AccountPanelTab } | null>(null);

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
  const [webhookStatus, setWebhookStatus] = useState<Record<string, { subscribed: boolean; callback_url: string; error?: string | null }>>({});
  const [ensuringWebhookId, setEnsuringWebhookId] = useState<string | null>(null);
  const [updatingTokenId, setUpdatingTokenId] = useState<string | null>(null);
  const [commerceDrafts, setCommerceDrafts] = useState<Record<string, { meta_catalog_id: string; commerce_enabled: boolean }>>({});
  const [commerceReadiness, setCommerceReadiness] = useState<Record<string, CommerceReadiness | null>>({});
  const [loadingReadinessId, setLoadingReadinessId] = useState<string | null>(null);
  const [brandingDrafts, setBrandingDrafts] = useState<Record<string, { brand_image_url: string }>>({});
  const [uploadingBrandingId, setUploadingBrandingId] = useState<string | null>(null);
  const [savingBrandingId, setSavingBrandingId] = useState<string | null>(null);
  const [syncingBrandingId, setSyncingBrandingId] = useState<string | null>(null);

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
      suspended: linked.filter((item) => item.status === "suspended").length,
      metaIssues: linked.filter((item) => getMetaHealthSeverity(item) !== "ok").length,
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

  useEffect(() => {
    const next: Record<string, { brand_image_url: string }> = {};
    for (const item of accounts.data ?? []) {
      next[item.id] = {
        brand_image_url: item.profile_image_url || item.catalog_cover_image_url || ""
      };
    }
    setBrandingDrafts(next);
  }, [accounts.data]);

  useEffect(() => {
    if (!panelState || panelState.tab !== "settings") return;
    void loadCommerceReadiness(panelState.accountId);
  }, [panelState]);

  useEffect(() => {
    for (const item of accounts.data ?? []) {
      if (item.commerce_enabled && item.meta_catalog_id?.trim()) {
        void loadCommerceReadiness(item.id);
      }
    }
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

  async function checkWebhookStatus(accountId: string) {
    try {
      const result = await api.get<{ subscribed: boolean; callback_url: string; error?: string | null }>(
        `/whatsapp/accounts/${accountId}/webhook-status`
      );
      setWebhookStatus((current) => ({ ...current, [accountId]: result.data }));
      toastStore.getState().show(
        result.data.subscribed ? "Webhook Meta مربوط." : "Webhook Meta غير مربوط — اضغط تأكيد الربط.",
        result.data.subscribed ? "success" : "error"
      );
    } catch {
      toastStore.getState().show("تعذر التحقق من Webhook Meta.", "error");
    }
  }

  async function ensureWebhook(accountId: string) {
    setEnsuringWebhookId(accountId);
    try {
      const result = await api.post<{ subscribed: boolean; callback_url: string; error?: string | null }>(
        `/whatsapp/accounts/${accountId}/ensure-webhook`
      );
      setWebhookStatus((current) => ({ ...current, [accountId]: result.data }));
      toastStore.getState().show(
        result.data.subscribed ? "تم تأكيد ربط Webhook Meta." : (result.data.error ?? "تعذر ربط Webhook Meta."),
        result.data.subscribed ? "success" : "error"
      );
    } catch {
      toastStore.getState().show("تعذر ربط Webhook Meta.", "error");
    } finally {
      setEnsuringWebhookId(null);
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
      await loadCommerceReadiness(accountId);
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
      toastStore.getState().show("تم حفظ Commerce وتفعيل الكتالوج على Meta.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ Commerce.", "error");
    }
  }

  async function loadCommerceReadiness(accountId: string) {
    setLoadingReadinessId(accountId);
    try {
      const response = await api.get<CommerceReadiness>(`/whatsapp/accounts/${accountId}/commerce/readiness`);
      setCommerceReadiness((current) => ({ ...current, [accountId]: response.data }));
    } catch {
      setCommerceReadiness((current) => ({ ...current, [accountId]: null }));
    } finally {
      setLoadingReadinessId(null);
    }
  }

  async function syncCatalogToMeta(accountId: string) {
    try {
      const response = await api.post<{
        synced: number;
        failed: number;
        total: number;
        pending?: number;
        approved?: number;
        rejected?: number;
        errors?: string[];
      }>(`/whatsapp/accounts/${accountId}/commerce/sync`);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await loadCommerceReadiness(accountId);
      const { synced, failed, total, pending = 0, approved = 0, rejected = 0, errors = [] } = response.data;
      const reviewSummary =
        synced > 0 ? ` — معتمد ${approved}، قيد المراجعة ${pending}، مرفوض ${rejected}` : "";
      const firstError = errors[0]?.replace(/^[^:]+:\s*/, "") ?? "";
      const detail = failed > 0 && firstError ? ` — ${firstError}` : "";
      toastStore
        .getState()
        .show(`مزامنة Meta: ${synced}/${total} نجح، ${failed} فشل${reviewSummary}${detail}.`, failed ? "error" : "success");
    } catch {
      toastStore.getState().show("تعذر مزامنة الكتالوج مع Meta.", "error");
    }
  }

  function extractApiDetail(error: unknown, fallback: string): string {
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
    ) {
      return (error as { response: { data: { detail: string } } }).response.data.detail;
    }
    return fallback;
  }

  async function persistBranding(accountId: string, brandImageUrl?: string): Promise<boolean> {
    const url = (brandImageUrl ?? brandingDrafts[accountId]?.brand_image_url ?? "").trim();
    await api.patch(`/whatsapp/accounts/${accountId}/branding`, {
      profile_image_url: url || null,
      catalog_cover_image_url: url || null
    });
    await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
    return true;
  }

  async function uploadBrandImage(accountId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      toastStore.getState().show("اختر صورة فقط (JPG / PNG / WebP).", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toastStore.getState().show("الصورة أكبر من 5MB.", "error");
      return;
    }
    setUploadingBrandingId(accountId);
    try {
      const uploaded = await uploadFile(file);
      const nextDraft = { brand_image_url: uploaded.public_url };
      setBrandingDrafts((current) => ({
        ...current,
        [accountId]: nextDraft
      }));
      await persistBranding(accountId, uploaded.public_url);
      toastStore.getState().show("تم رفع صورة الهوية وحفظها.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploadingBrandingId(null);
    }
  }

  async function saveBranding(accountId: string): Promise<boolean> {
    const draft = brandingDrafts[accountId];
    if (!draft?.brand_image_url?.trim()) {
      toastStore.getState().show("ارفع صورة الهوية أولاً.", "error");
      return false;
    }
    setSavingBrandingId(accountId);
    try {
      await persistBranding(accountId);
      toastStore.getState().show("تم حفظ صورة الهوية.", "success");
      return true;
    } catch {
      toastStore.getState().show("تعذر حفظ صورة الهوية.", "error");
      return false;
    } finally {
      setSavingBrandingId(null);
    }
  }

  async function syncBrandingToMeta(accountId: string) {
    setSyncingBrandingId(accountId);
    try {
      const draft = brandingDrafts[accountId];
      if (!draft?.brand_image_url?.trim()) {
        toastStore.getState().show("ارفع صورة الهوية أولاً.", "error");
        return;
      }
      await persistBranding(accountId);
      const response = await api.post<{
        synced: boolean;
        errors?: string[];
        profile?: { synced?: boolean } | null;
        catalog_cover?: { synced?: boolean } | null;
      }>(`/whatsapp/accounts/${accountId}/branding/sync-all`);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      const errors = response.data.errors ?? [];
      if (errors.length > 0) {
        toastStore.getState().show(`تفعيل جزئي — ${errors[0]}`, "error");
      } else {
        toastStore
          .getState()
          .show("تم تفعيل الهوية على Meta — قد يتأخر ظهورها في WhatsApp 5–15 دقيقة.", "success");
      }
    } catch (error: unknown) {
      toastStore.getState().show(extractApiDetail(error, "تعذر تفعيل الهوية على Meta."), "error");
    } finally {
      setSyncingBrandingId(null);
    }
  }

  async function disconnectAccount(accountId: string) {
    try {
      await api.post(`/whatsapp/accounts/${accountId}/disconnect`);
      await client.invalidateQueries({ queryKey: ["whatsapp-accounts"] });
      toastStore.getState().show("تم فصل الحساب.", "success");
      if (panelState?.accountId === accountId) setPanelState(null);
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

  function toggleAccountPanel(accountId: string, tab: AccountPanelTab) {
    setPanelState((current) => {
      if (current?.accountId === accountId && current.tab === tab) return null;
      return { accountId, tab };
    });
  }

  function closeAccountPanel() {
    setPanelState(null);
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
    const readiness = commerceReadiness[accountId];
    if (!status && !readiness) return <span className="admin-chip admin-chip-muted">غير مفحوص</span>;
    const valid = status?.valid ?? readiness?.token_valid;
    const missingCatalogScope =
      readiness?.commerce_enabled && readiness.token_valid !== false && !readiness.has_catalog_management;
    if (missingCatalogScope) {
      return <span className="admin-status admin-status-pending">Token · بدون catalog</span>;
    }
    return (
      <span className={valid ? "admin-status admin-status-active" : "admin-status admin-status-danger"}>
        {valid ? "Token ✓" : "Token ✗"}
      </span>
    );
  }

  function renderCatalogScopeWarning(accountId: string, commerceOn: boolean) {
    const readiness = commerceReadiness[accountId];
    if (loadingReadinessId === accountId) {
      return <p className="hint-text">جاري فحص صلاحيات التوكن…</p>;
    }
    if (!readiness || !commerceOn) return null;
    if (readiness.token_valid === false) {
      return (
        <div className="whatsapp-replace-warning" role="alert">
          <strong>رمز Meta غير صالح</strong>
          <p className="hint-text">حدّث System User Token من Meta Business ثم احفظه هنا.</p>
        </div>
      );
    }
    if (!readiness.has_catalog_management) {
      return (
        <div className="whatsapp-replace-warning" role="alert">
          <strong>صلاحية catalog_management مفقودة</strong>
          <p className="hint-text">
            التوكن الحالي لا يملك صلاحية إدارة الكتالوج — لذلك تفشل مزامنة المنتجات حتى لو كان Catalog ID
            {" "}
            <span dir="ltr">{readiness.meta_catalog_id ?? ""}</span>
            {" "}
            صحيحاً في Commerce Manager.
          </p>
          <p className="hint-text">
            في Meta Business → System Users → أنشئ Token جديداً مع{" "}
            <span dir="ltr">catalog_management</span>
            {" "}
            و
            <span dir="ltr"> whatsapp_business_management</span>
            {" "}
            ثم الصقه في «تحديث الرمز» أدناه.
          </p>
          {readiness.token_scopes.length > 0 && (
            <p className="hint-text" dir="ltr">
              Scopes: {readiness.token_scopes.join(", ")}
            </p>
          )}
        </div>
      );
    }
    return null;
  }

  function renderDetailsContent(account: WhatsAppAccountRow, row: TableRow) {
    return (
      <>
        <p className="hint-text whatsapp-panel-subtitle">{row.channelName} · {row.organizationName}</p>
        <div className="whatsapp-details-grid">
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">WABA ID</span>
                <code dir="ltr">{account.waba_id}</code>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">Phone Number ID</span>
                <code dir="ltr">{account.phone_number_id}</code>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">الجودة</span>
                <span className={qualityBadgeClass(account.quality_rating)}>
                  {formatQualityRating(account.quality_rating)}
                </span>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">حد الإرسال</span>
                <span>{formatMessagingLimit(account)}</span>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">طريقة الربط</span>
                <span className={connectionMethodClass(account.connection_method)}>
                  {formatConnectionMethod(account.connection_method)}
                </span>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">آخر مزامنة Meta</span>
                <span>{formatHealthSynced(account.health_synced_at)}</span>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">Commerce</span>
                <span className={commerceStatusClass(account)}>{formatCommerceSummary(account)}</span>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">حالة Meta</span>
                <div className="whatsapp-details-stack">
                  <span className={metaHealthBadgeClass(account)}>{formatMetaHealthLabel(account)}</span>
                  <small className="meta-health-details">{formatMetaHealthDetails(account)}</small>
                </div>
              </div>
              <div className="whatsapp-details-item">
                <span className="whatsapp-details-label">Watesly</span>
                <span className={whatsappStatusBadgeClass(account.status)}>{formatWhatsAppStatus(account.status)}</span>
              </div>
              {account.meta_catalog_id && (
                <div className="whatsapp-details-item">
                  <span className="whatsapp-details-label">Catalog ID</span>
                  <code dir="ltr">{account.meta_catalog_id}</code>
                </div>
              )}
              {account.catalog_synced_at && (
                <div className="whatsapp-details-item">
                  <span className="whatsapp-details-label">مزامنة الكتالوج</span>
                  <span>{formatHealthSynced(account.catalog_synced_at)}</span>
                </div>
              )}
            </div>
            <div className="admin-actions whatsapp-details-actions">
              <button
                type="button"
                className="secondary-button compact"
                disabled={syncingId === account.id}
                onClick={() => void syncHealth(account.id)}
              >
                {syncingId === account.id ? "…" : "مزامنة Meta"}
              </button>
              <Link to="/inbox" className="secondary-button compact">Inbox</Link>
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => openConnectForChannel(row.channel.id)}
              >
                استبدال الرقم
              </button>
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => toggleAccountPanel(account.id, "settings")}
              >
                إعدادات
              </button>
              <button
                type="button"
                className="secondary-button compact danger-text"
                onClick={() => void disconnectAccount(account.id)}
              >
                فصل
              </button>
            </div>
      </>
    );
  }

  function renderSettingsContent(account: WhatsAppAccountRow) {
    const commerceDraft = commerceDrafts[account.id];
    const brandingDraft = brandingDrafts[account.id];
    const savedCatalogId = account.meta_catalog_id?.trim() || commerceDraft?.meta_catalog_id?.trim() || "";
    const commerceOn = account.commerce_enabled || commerceDraft?.commerce_enabled;
    const brandingBusy =
      syncingBrandingId === account.id ||
      savingBrandingId === account.id ||
      uploadingBrandingId === account.id;
    const brandImageUrl = brandingDraft?.brand_image_url?.trim() || "";
    const brandingSyncedAt = account.profile_image_synced_at || account.catalog_cover_synced_at;
    const brandingPending = Boolean(brandImageUrl) && !brandingSyncedAt;

    return (
      <div className="whatsapp-expand-grid">
              <article className="whatsapp-expand-panel whatsapp-expand-full whatsapp-expand-commerce">
                <h3>WhatsApp Commerce — الكتالوج</h3>
                <p className="hint-text">
                  {commerceOn && savedCatalogId
                    ? `Commerce مفعّل · Catalog ID: ${savedCatalogId}`
                    : "أدخل Catalog ID من Meta Commerce Manager ثم احفظ."}
                </p>
                {renderCatalogScopeWarning(account.id, Boolean(commerceOn && savedCatalogId))}
                <label className="field-label">
                  <span>Meta Catalog ID</span>
                  <input
                    dir="ltr"
                    value={commerceDraft?.meta_catalog_id ?? ""}
                    onChange={(e) =>
                      setCommerceDrafts((current) => ({
                        ...current,
                        [account.id]: {
                          meta_catalog_id: e.target.value,
                          commerce_enabled: current[account.id]?.commerce_enabled ?? false
                        }
                      }))
                    }
                    placeholder="1677372356655691"
                  />
                </label>
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={commerceDraft?.commerce_enabled ?? false}
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
                <div className="admin-actions">
                  <button type="button" className="whatsapp-button compact" onClick={() => void saveCommerce(account.id)}>
                    حفظ Commerce
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => void syncCatalogToMeta(account.id)}
                    disabled={!savedCatalogId}
                  >
                    مزامنة المنتجات → Meta
                  </button>
                </div>
              </article>
              <article className="whatsapp-expand-panel whatsapp-expand-full whatsapp-expand-branding">
                <div className="whatsapp-branding-head">
                  <div>
                    <h3>الهوية البصرية</h3>
                    <p className="hint-text">
                      صورة واحدة لـ WhatsApp — تظهر في المحادثات وأعلى الكتالوج. Meta لا يدعم صورتين منفصلتين.
                    </p>
                  </div>
                  {brandingSyncedAt ? (
                    <span className="admin-chip admin-chip-whatsapp">مفعّل على Meta</span>
                  ) : brandImageUrl ? (
                    <span className="admin-chip admin-chip-muted">محفوظ · لم يُفعَّل</span>
                  ) : null}
                </div>

                {brandingPending && (
                  <p className="hint-text whatsapp-branding-pending" role="alert">
                    الصورة محفوظة — اضغط «تفعيل على Meta» لتطبيقها في WhatsApp.
                  </p>
                )}

                <div className="whatsapp-branding-unified">
                  <div className="whatsapp-branding-preview">
                    <div className="whatsapp-branding-preview-frame">
                      {brandImageUrl ? (
                        <img src={brandImageUrl} alt="معاينة الهوية" className="whatsapp-branding-preview-img" />
                      ) : (
                        <div className="whatsapp-branding-preview-empty">ارفع شعار الشركة</div>
                      )}
                      <div className="whatsapp-branding-preview-name">
                        {account.verified_name || account.display_phone_number || "اسم الشركة"}
                      </div>
                    </div>
                    <ul className="whatsapp-branding-uses">
                      <li>
                        <span className="whatsapp-branding-use-icon" aria-hidden="true">💬</span>
                        <span>بجانب اسم الشركة في المحادثات</span>
                      </li>
                      <li>
                        <span className="whatsapp-branding-use-icon" aria-hidden="true">🛍️</span>
                        <span>أعلى صفحة الكتالوج داخل WhatsApp</span>
                      </li>
                    </ul>
                  </div>

                  <div className="whatsapp-branding-form">
                    <label className="field-label">
                      <span>صورة الهوية</span>
                      <span className="hint-text">JPG · PNG · WebP — حتى 5MB · يُفضّل 640×640 أو أكبر</span>
                    </label>
                    <div className="whatsapp-branding-upload-row">
                      <label className="whatsapp-branding-upload-btn">
                        {uploadingBrandingId === account.id ? "جاري الرفع…" : "رفع صورة"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          disabled={brandingBusy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void uploadBrandImage(account.id, file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <input
                        dir="ltr"
                        className="whatsapp-branding-url-input"
                        value={brandingDraft?.brand_image_url ?? ""}
                        onChange={(e) =>
                          setBrandingDrafts((current) => ({
                            ...current,
                            [account.id]: { brand_image_url: e.target.value }
                          }))
                        }
                        placeholder="https://… أو ارفع من الجهاز"
                      />
                    </div>
                    {brandingSyncedAt && (
                      <p className="hint-text whatsapp-branding-synced">
                        ✓ آخر تفعيل على Meta: {formatHealthSynced(brandingSyncedAt)}
                      </p>
                    )}
                    {!commerceOn || !savedCatalogId ? (
                      <p className="hint-text whatsapp-branding-note">
                        بدون Commerce: تُفعَّل صورة الملف فقط. فعّل Commerce أعلاه لتطبيقها على الكتالوج أيضاً.
                      </p>
                    ) : (
                      <p className="hint-text whatsapp-branding-note">
                        التغيير قد يتأخر 5–15 دقيقة — أغلق الكتالوج في WhatsApp وأعد فتحه.
                      </p>
                    )}
                    <div className="whatsapp-branding-actions">
                      <button
                        type="button"
                        className="whatsapp-button compact"
                        disabled={!brandImageUrl || brandingBusy}
                        onClick={() => void syncBrandingToMeta(account.id)}
                      >
                        {syncingBrandingId === account.id ? "جاري التفعيل…" : "تفعيل على Meta"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!brandImageUrl || brandingBusy}
                        onClick={() => void saveBranding(account.id)}
                      >
                        {savingBrandingId === account.id ? "جاري الحفظ…" : "حفظ فقط"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
              <article className="whatsapp-expand-panel whatsapp-expand-full whatsapp-expand-token">
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
              <article className="whatsapp-expand-panel whatsapp-expand-full whatsapp-expand-split">
                <div className="whatsapp-expand-split-col">
                  <h3>Webhook Meta</h3>
                  <p className="hint-text">
                    {webhookStatus[account.id]?.subscribed
                      ? "الاستقبال والحملات وتحديث القوالب مربوطة بـ Meta."
                      : webhookStatus[account.id]?.error ?? "تحقق من الربط أو اضغط تأكيد الربط."}
                  </p>
                  {webhookStatus[account.id]?.callback_url && (
                    <code dir="ltr" className="hint-text">{webhookStatus[account.id]?.callback_url}</code>
                  )}
                  <div className="admin-actions">
                    <button type="button" className="secondary-button" onClick={() => void checkWebhookStatus(account.id)}>
                      فحص Webhook
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={ensuringWebhookId === account.id}
                      onClick={() => void ensureWebhook(account.id)}
                    >
                      {ensuringWebhookId === account.id ? "جاري الربط…" : "تأكيد الربط"}
                    </button>
                  </div>
                </div>
                <div className="whatsapp-expand-split-col">
                  <h3>Meta IDs</h3>
                  <div className="whatsapp-meta-id-list">
                    <div><span>WABA ID</span><code dir="ltr">{account.waba_id}</code></div>
                    <div><span>Phone Number ID</span><code dir="ltr">{account.phone_number_id}</code></div>
                  </div>
                  {account.catalog_synced_at && (
                    <p className="hint-text">Catalog sync: {formatHealthSynced(account.catalog_synced_at)}</p>
                  )}
                </div>
              </article>
            </div>
    );
  }

  function renderAccountPanelRow(account: WhatsAppAccountRow, row: TableRow, tab: AccountPanelTab) {
    return (
      <tr className="whatsapp-panel-row">
        <td colSpan={WHATSAPP_ACCOUNT_TABLE_COLS}>
          <div className="whatsapp-panel-shell">
            <div className="whatsapp-panel-toolbar">
              <div className="whatsapp-panel-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "details"}
                  className={tab === "details" ? "whatsapp-panel-tab active" : "whatsapp-panel-tab"}
                  onClick={() => toggleAccountPanel(account.id, "details")}
                >
                  تفاصيل
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "settings"}
                  className={tab === "settings" ? "whatsapp-panel-tab active" : "whatsapp-panel-tab"}
                  onClick={() => toggleAccountPanel(account.id, "settings")}
                >
                  إعدادات
                </button>
              </div>
              <button type="button" className="secondary-button compact" onClick={closeAccountPanel}>
                إغلاق
              </button>
            </div>
            {tab === "details" ? renderDetailsContent(account, row) : renderSettingsContent(account)}
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
          <p>جدول مرتب لكل قناة — صف واحد مختصر مع تفاصيل كاملة وإعدادات عند الطلب.</p>
        </div>
        <Link to="/channels" className="secondary-button">إدارة القنوات ←</Link>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>قنوات WhatsApp</span><strong>{stats.channels}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>حسابات مربوطة</span><strong>{stats.linked}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>متصل</span><strong>{stats.active}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>Embedded</span><strong>{stats.embedded}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>تنبيه Meta</span><strong>{stats.metaIssues}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>موقوف</span><strong>{stats.suspended}</strong></article>
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
              <small>{filteredRows.length} صف · صف واحد ثابت · تفاصيل وإعدادات في لوحة واحدة</small>
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
              <option value="suspended">موقوف / Meta</option>
              <option value="disconnected">غير متصل</option>
              <option value="pending">قيد الربط</option>
              <option value="unlinked">غير مربوط</option>
            </select>
          </div>

          <div className="admin-table-wrap whatsapp-accounts-table-wrap">
            <table className="admin-erp-table whatsapp-erp-table whatsapp-accounts-compact">
              <thead>
                <tr>
                  <th>الحساب</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {accounts.isLoading && (
                  <tr><td colSpan={WHATSAPP_ACCOUNT_TABLE_COLS} className="admin-table-empty">جاري التحميل…</td></tr>
                )}
                {!accounts.isLoading && filteredRows.length === 0 && (
                  <tr><td colSpan={WHATSAPP_ACCOUNT_TABLE_COLS} className="admin-table-empty">لا توجد قنوات WhatsApp.</td></tr>
                )}
                {filteredRows.map((row) => {
                  const account = row.account;
                  if (!account) {
                    return (
                      <tr key={row.key} className="whatsapp-account-row">
                        <td>
                          <div className="whatsapp-account-inline" title={`${row.channelName} · ${row.organizationName}`}>
                            <strong>{row.channelName}</strong>
                            <small>{row.organizationName}</small>
                          </div>
                        </td>
                        <td><span className="admin-status admin-status-pending">غير مربوط</span></td>
                        <td>
                          <button type="button" className="whatsapp-button compact" onClick={() => openConnectForChannel(row.channel.id)}>
                            ربط
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  const panelOpen = panelState?.accountId === account.id;
                  const panelTab = panelState?.tab ?? "details";
                  const accountTitle = `${account.verified_name || row.channelName} · ${account.display_phone_number} · ${row.channelName}`;
                  return (
                    <Fragment key={account.id}>
                      <tr className="whatsapp-account-row">
                        <td>
                          <div className="whatsapp-account-inline" title={accountTitle}>
                            <strong>{account.verified_name || row.channelName}</strong>
                            <span dir="ltr" className="whatsapp-account-phone">{account.display_phone_number}</span>
                            <small>{row.channelName}</small>
                          </div>
                        </td>
                        <td>
                          <div className="whatsapp-indicators-inline">
                            <span
                              className={metaHealthBadgeClass(account)}
                              title={formatMetaHealthLabel(account)}
                            >
                              {formatMetaHealthShort(account)}
                            </span>
                            <span className={whatsappStatusBadgeClass(account.status)}>
                              {formatWhatsAppStatus(account.status)}
                            </span>
                            <span className={commerceStatusClass(account)} title={formatCommerceSummary(account)}>
                              {formatCommerceShort(account)}
                            </span>
                            {renderTokenBadge(account.id)}
                          </div>
                        </td>
                        <td>
                          <div className="admin-actions whatsapp-row-actions whatsapp-row-actions-compact">
                            <button
                              type="button"
                              className={panelOpen && panelTab === "details" ? "whatsapp-button compact" : "secondary-button compact"}
                              onClick={() => toggleAccountPanel(account.id, "details")}
                            >
                              تفاصيل
                            </button>
                            <button
                              type="button"
                              className={panelOpen && panelTab === "settings" ? "whatsapp-button compact" : "secondary-button compact"}
                              onClick={() => toggleAccountPanel(account.id, "settings")}
                            >
                              إعدادات
                            </button>
                          </div>
                        </td>
                      </tr>
                      {panelOpen && renderAccountPanelRow(account, row, panelTab)}
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
