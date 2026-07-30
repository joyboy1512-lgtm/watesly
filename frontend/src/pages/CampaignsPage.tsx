import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  buildSendComponents,
  getTemplateHeaderInfo,
  HEADER_FORMAT_LABELS,
  HEADER_MEDIA_ACCEPT,
  type TemplateComponent
} from "../lib/templateMedia";
import { uploadFile, type UploadedFile } from "../lib/uploads";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import { toastStore } from "../stores/toast";
import {
  CampaignResultsTable,
  CampaignResultBadge,
  isActiveCampaignStatus,
  type CampaignReport,
  type CampaignSummaryRow
} from "../components/CampaignRecipientsPanel";

type Organization = { id: string; name: string };
type Channel = { id: string; name: string; type: string; organization_id: string };
type WhatsAppAccount = { id: string; display_phone_number: string; verified_name: string | null };
type Template = {
  id: string;
  name: string;
  status: string;
  body_text: string | null;
  components: TemplateComponent[] | null;
};
type Contact = { id: string; display_name: string | null; external_address: string };
type Segment = { id: string; name: string };
type CampaignPreflight = {
  total: number;
  never_messaged: number;
  window_open: number;
  window_closed: number;
  warnings: string[];
  messaging_tier_hint: string;
  quality_rating?: string | null;
  messaging_limit?: number | null;
};
type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  report: CampaignReport & { pending: number; queued: number; skipped: number };
};
type CatalogProductOption = { id: string; name: string; image_url: string | null };
type TrackedLink = {
  id: string;
  name: string;
  slug: string;
  phone_number: string;
  prefill_message: string | null;
  campaign_id: string | null;
  click_count: number;
  track_url: string;
  wa_me_url: string;
};

function resolvePublicApiUrl(path: string) {
  if (path.startsWith("http")) return path;
  const base = api.defaults.baseURL ?? "http://localhost:8000/api/v1";
  const origin = base.replace(/\/api\/v1\/?$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function toSummaryRow(campaign: CampaignListItem): CampaignSummaryRow {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduled_at: campaign.scheduled_at,
    completed_at: campaign.completed_at,
    total: campaign.report.total,
    sent: campaign.report.sent,
    delivered: campaign.report.delivered,
    read: campaign.report.read,
    failed: campaign.report.failed,
    pending: campaign.report.pending
  };
}

export default function CampaignsPage() {
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const listRef = useRef<HTMLElement | null>(null);
  const createRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [highlightCampaignId, setHighlightCampaignId] = useState<string | null>(null);
  const [campaignMediaOverride, setCampaignMediaOverride] = useState<UploadedFile | null>(null);
  const [uploadingCampaignMedia, setUploadingCampaignMedia] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [preflight, setPreflight] = useState<CampaignPreflight | null>(null);
  const [linkName, setLinkName] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [linkCampaignId, setLinkCampaignId] = useState("");

  const organizations = useQuery({ queryKey: ["organizations"], queryFn: async () => (await api.get<Organization[]>("/organizations")).data });
  const channels = useQuery({ queryKey: ["channels"], queryFn: async () => (await api.get<Channel[]>("/channels")).data });
  const accounts = useQuery({ queryKey: ["whatsapp-accounts"], queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data });
  const templates = useQuery({ queryKey: ["templates"], queryFn: async () => (await api.get<Template[]>("/templates")).data });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: async () => (await api.get<Contact[]>("/contacts")).data });
  const segments = useQuery({
    queryKey: ["segments"],
    queryFn: async () => (await api.get<Segment[]>("/platform/segments")).data
  });

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => (await api.get<CampaignListItem[]>("/campaigns")).data,
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some((item) => isActiveCampaignStatus(item.status)) ? 5000 : false;
    }
  });
  const trackedLinks = useQuery({
    queryKey: ["tracked-links"],
    queryFn: async () => (await api.get<TrackedLink[]>("/tracking/links")).data,
    retry: 1,
    staleTime: 60_000
  });
  const catalogProducts = useQuery({
    queryKey: ["catalog-campaign"],
    queryFn: async () => (await api.get<CatalogProductOption[]>("/catalog")).data
  });

  const campaignRows = useMemo(
    () => (campaigns.data ?? []).map(toSummaryRow),
    [campaigns.data]
  );

  const latestFinishedCampaign = useMemo(
    () => campaignRows.find((item) => ["completed", "completed_with_errors", "failed"].includes(item.status)),
    [campaignRows]
  );

  useEffect(() => {
    if (!highlightCampaignId) return;
    const timer = window.setTimeout(() => setHighlightCampaignId(null), 8000);
    return () => window.clearTimeout(timer);
  }, [highlightCampaignId]);

  useEffect(() => {
    if (searchParams.get("action") !== "create") return;
    createRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    createRef.current?.classList.add("page-focus-highlight");
    const timer = window.setTimeout(() => {
      createRef.current?.classList.remove("page-focus-highlight");
      setSearchParams({}, { replace: true });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const idsParam = searchParams.get("contact_ids");
    if (!idsParam) return;
    const ids = idsParam.split(",").map((item) => item.trim()).filter(Boolean);
    if (ids.length > 0) {
      setSelectedContacts(ids);
      createRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [searchParams]);

  const orgChannels = (channels.data ?? []).filter((item) => !organizationId || item.organization_id === organizationId);
  const approvedTemplates = (templates.data ?? []).filter((item) => item.status === "approved");
  const selectedTemplate = useMemo(
    () => approvedTemplates.find((item) => item.id === templateId) ?? null,
    [approvedTemplates, templateId]
  );
  const templateHeader = useMemo(
    () => getTemplateHeaderInfo(selectedTemplate?.components),
    [selectedTemplate]
  );
  const selectedAccount = useMemo(
    () => (accounts.data ?? []).find((item) => item.id === accountId) ?? null,
    [accounts.data, accountId]
  );
  const filteredContacts = (contacts.data ?? []).filter((item) => {
    if (!contactSearch.trim()) return true;
    const term = contactSearch.trim().toLowerCase();
    return (
      item.external_address.toLowerCase().includes(term) ||
      (item.display_name ?? "").toLowerCase().includes(term)
    );
  });

  useEffect(() => {
    if (!templateId || !selectedContacts.length) {
      setPreflight(null);
      return;
    }
    void api
      .post("/campaigns/preflight", {
        template_id: templateId,
        contact_ids: selectedContacts,
        whatsapp_account_id: accountId || null
      })
      .then((res) => setPreflight(res.data as CampaignPreflight))
      .catch(() => setPreflight(null));
  }, [templateId, selectedContacts, accountId]);

  function onOrganizationChange(value: string) {
    setOrganizationId(value);
    setChannelId("");
  }

  async function importAudience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!organizationId || !channelId) {
      toastStore.getState().show("اختر الفرع والقناة أولاً.", "error");
      return;
    }
    form.set("organization_id", organizationId);
    form.set("channel_id", channelId);
    try {
      const result = await api.post("/campaigns/import-audience", form, { headers: { "Content-Type": "multipart/form-data" } });
      const ids: string[] = result.data.contact_ids ?? [];
      setSelectedContacts(ids);
      toastStore.getState().show(
        `تم تحميل ${ids.length} عميل (${result.data.created} جديد، ${result.data.existing} موجود).`,
        "success"
      );
      await client.invalidateQueries({ queryKey: ["contacts"] });
      event.currentTarget.reset();
    } catch {
      toastStore.getState().show("تعذر استيراد ملف العملاء. استخدم Excel (.xlsx) أو CSV.", "error");
    }
  }

  async function loadSegmentAudience() {
    if (!selectedSegmentId) return;
    try {
      const result = await api.get<{ id: string }[]>(`/platform/segments/${selectedSegmentId}/contacts`);
      const ids = result.data.map((item) => item.id);
      setSelectedContacts(ids);
      toastStore.getState().show(`تم تحميل ${ids.length} عميل من الشريحة.`, "success");
    } catch {
      toastStore.getState().show("تعذر تحميل الشريحة.", "error");
    }
  }

  async function onCampaignMediaChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setUploadingCampaignMedia(true);
    try {
      const uploaded = await uploadFile(file);
      setCampaignMediaOverride(uploaded);
      toastStore.getState().show("تم رفع ملف الحملة.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الملف.", "error");
      input.value = "";
    } finally {
      setUploadingCampaignMedia(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!selectedContacts.length) {
      toastStore.getState().show("اختر عملاء للحملة أو ارفع Excel.", "error");
      return;
    }
    if (templateHeader && !templateHeader.mediaUrl && !campaignMediaOverride) {
      toastStore.getState().show("القالب يتطلب وسائط في الرأس — ارفع صورة أو فيديو أو PDF.", "error");
      return;
    }
    try {
      const templateParameters = buildSendComponents(selectedTemplate?.components, campaignMediaOverride
        ? { mediaUrl: campaignMediaOverride.public_url, filename: campaignMediaOverride.filename }
        : undefined);
      const response = await api.post("/campaigns", {
        organization_id: organizationId,
        whatsapp_account_id: accountId,
        template_id: templateId,
        name,
        scheduled_at: null,
        recipients: selectedContacts.map((contact_id) => ({
          contact_id,
          template_parameters: templateParameters
        }))
      });
      const campaignId = response.data.id as string;
      await api.post(`/campaigns/${campaignId}/approve`);
      await api.post(`/campaigns/${campaignId}/start`);
      setName("");
      setSelectedContacts([]);
      setCampaignMediaOverride(null);
      setExpandedCampaignId(campaignId);
      setHighlightCampaignId(campaignId);
      await client.invalidateQueries({ queryKey: ["campaigns"] });
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      toastStore.getState().show("تم بدء الحملة — تظهر النتيجة في الجدول أدناه.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء الحملة. تحقق من القالب المعتمد والحساب.", "error");
    }
  }

  async function createTrackedLink(event: FormEvent) {
    event.preventDefault();
    const phone = selectedAccount?.display_phone_number;
    if (!phone) {
      toastStore.getState().show("اختر حساب WhatsApp أولاً.", "error");
      return;
    }
    try {
      await api.post("/tracking/links", {
        name: linkName,
        phone_number: phone,
        prefill_message: linkMessage.trim() || null,
        campaign_id: linkCampaignId || null
      });
      setLinkName("");
      setLinkMessage("");
      setLinkCampaignId("");
      await client.invalidateQueries({ queryKey: ["tracked-links"] });
      toastStore.getState().show("تم إنشاء رابط التتبع.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء رابط التتبع.", "error");
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toastStore.getState().show(`تم نسخ ${label}.`, "success");
    } catch {
      toastStore.getState().show("تعذر النسخ.", "error");
    }
  }

  return (
    <main className="page campaigns-page">
      <header className="page-header">
        <h1>حملات WhatsApp</h1>
        <p>إرسال رسائل جماعية بقوالب معتمدة — النتيجة والتقرير تظهر مباشرة بعد الإرسال.</p>
      </header>

      {latestFinishedCampaign && (
        <section className="card campaign-latest-result">
          <h2 className="section-title-sm">آخر نتيجة حملة</h2>
          <div className="campaign-latest-result-body">
            <strong>{latestFinishedCampaign.name}</strong>
            <CampaignResultBadge status={latestFinishedCampaign.status} report={latestFinishedCampaign} />
          </div>
        </section>
      )}

      <section
        ref={listRef}
        className={`card campaigns-list-card${highlightCampaignId ? " campaigns-list-highlight" : ""}`}
      >
        <div className="campaigns-list-header">
          <div>
            <h2 className="section-title">نتائج الحملات</h2>
            <p className="hint-text">
              بعد الإرسال تظهر النتيجة: تمت بنجاح · تمت بأخطاء · فشلت · جاري الإرسال — اضغط «عرض التقرير» للتفاصيل.
            </p>
          </div>
          <p className="hint-text">{campaigns.data?.length ?? 0} حملة</p>
        </div>
        {campaigns.isLoading && <p className="hint-text">جاري تحميل نتائج الحملات…</p>}
        {campaigns.isError && <p className="hint-text">تعذر تحميل نتائج الحملات.</p>}
        <CampaignResultsTable
          items={campaignRows}
          expandedCampaignId={expandedCampaignId}
          onToggleExpanded={(id) => setExpandedCampaignId((current) => (current === id ? null : id))}
          showScheduled
          autoRefresh
          emptyLabel="لا توجد حملات بعد."
        />
      </section>

      <section className="card">
        <h2 className="section-title">روابط تتبع wa.me</h2>
        <p className="hint-text">
          أنشئ رابطاً قصيراً يُحسب عليه النقر ثم يُحوّل إلى WhatsApp مع ref للربط بالحملة — كما في Wati.
        </p>
        <form className="stack-form campaigns-actions-grid" onSubmit={(e) => void createTrackedLink(e)}>
          <label className="field-label">
            <span>اسم الرابط</span>
            <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="عرض رمضان" required />
          </label>
          <label className="field-label">
            <span>رسالة مسبقة (اختياري)</span>
            <input value={linkMessage} onChange={(e) => setLinkMessage(e.target.value)} placeholder="مرحباً، أريد العرض" />
          </label>
          <label className="field-label">
            <span>ربط بحملة (اختياري)</span>
            <select value={linkCampaignId} onChange={(e) => setLinkCampaignId(e.target.value)}>
              <option value="">—</option>
              {(campaigns.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <p className="hint-text">
            {selectedAccount
              ? `سيُستخدم رقم: ${selectedAccount.display_phone_number}`
              : "اختر حساب WhatsApp في نموذج الحملة أدناه لتحديد الرقم."}
          </p>
          <button type="submit" className="secondary-button" disabled={!linkName.trim() || !selectedAccount}>
            إنشاء رابط
          </button>
        </form>
        {trackedLinks.isLoading && <p className="hint-text">جاري تحميل الروابط…</p>}
        {(trackedLinks.data ?? []).length > 0 && (
          <div className="table-scroll">
            <table className="data-table tracked-links-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>نقرات</th>
                  <th>رابط التتبع</th>
                  <th>wa.me</th>
                </tr>
              </thead>
              <tbody>
                {(trackedLinks.data ?? []).map((item) => {
                  const trackFull = resolvePublicApiUrl(item.track_url);
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.click_count}</td>
                      <td>
                        <code>{trackFull}</code>
                        <button type="button" className="secondary-button" onClick={() => void copyText(trackFull, "رابط التتبع")}>
                          نسخ
                        </button>
                      </td>
                      <td>
                        <button type="button" className="secondary-button" onClick={() => void copyText(item.wa_me_url, "wa.me")}>
                          نسخ wa.me
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section ref={createRef} className="card campaigns-manage-card">
        <h2 className="section-title">إنشاء حملة جديدة</h2>

        <div className="campaigns-context-row">
          <label className="field-label">
            <span>الفرع</span>
            <select value={organizationId} onChange={(e) => onOrganizationChange(e.target.value)} required form="campaign-create-form">
              <option value="">اختر الفرع</option>
              {(organizations.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>القناة (لاستيراد Excel)</span>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!organizationId}>
              <option value="">اختر القناة</option>
              {orgChannels.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="campaigns-actions-grid">
          <form className="campaigns-panel stack-form" onSubmit={importAudience}>
            <h3>جمهور الحملة — Excel</h3>
            <label className="field-label">
              <span>ملف Excel أو CSV</span>
              <input
                name="file"
                type="file"
                accept=".xlsx,.xlsm,.csv,text/csv"
                required
                disabled={!organizationId || !channelId}
              />
            </label>
            <p className="hint-text">الأعمدة: phone (رقم) · name (اسم)</p>
            <button type="submit" disabled={!organizationId || !channelId}>تحميل العملاء</button>
            {selectedContacts.length > 0 && (
              <p className="hint-text">✓ {selectedContacts.length} عميل محدّد للحملة</p>
            )}
          </form>

          <form id="campaign-create-form" className="campaigns-panel stack-form" onSubmit={create}>
            <h3>إعدادات الحملة</h3>
            <label className="field-label">
              <span>اسم الحملة</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="عرض رمضان 2026"
                required
              />
            </label>
            <label className="field-label">
              <span>حساب WhatsApp</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="">اختر الحساب</option>
                {(accounts.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.verified_name || item.display_phone_number}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>القالب المعتمد</span>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setCampaignMediaOverride(null);
                }}
                required
              >
                <option value="">اختر القالب</option>
                {approvedTemplates.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            {templateHeader && (
              <div className="campaign-template-media">
                <p className="hint-text">
                  القالب يتضمن رأس {HEADER_FORMAT_LABELS[templateHeader.format]}
                  {templateHeader.mediaUrl ? " — يُستخدم الملف المخزّن أو ارفع بديلاً." : " — ارفع الملف المطلوب."}
                </p>
                <label className="field-label">
                  <span>ملف رأس القالب (اختياري للاستبدال)</span>
                  <input
                    type="file"
                    accept={HEADER_MEDIA_ACCEPT}
                    onChange={(e) => void onCampaignMediaChange(e)}
                    disabled={uploadingCampaignMedia}
                  />
                  {campaignMediaOverride && (
                    <p className="hint-text">✓ {campaignMediaOverride.filename}</p>
                  )}
                </label>
                {(catalogProducts.data ?? []).some((item) => item.image_url) && (
                  <label className="field-label">
                    <span>أو اختر صورة من الكatalog</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const product = (catalogProducts.data ?? []).find((item) => item.id === e.target.value);
                        if (!product?.image_url) return;
                        setCampaignMediaOverride({
                          id: product.id,
                          filename: `${product.name}.jpg`,
                          content_type: "image/jpeg",
                          size_bytes: 0,
                          object_key: product.id,
                          public_url: product.image_url
                        });
                      }}
                    >
                      <option value="">—</option>
                      {(catalogProducts.data ?? [])
                        .filter((item) => item.image_url)
                        .map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {selectedTemplate && (
              <div className="campaign-template-preview-wrap">
                <WhatsAppTemplatePreview
                  compact
                  bodyText={selectedTemplate.body_text}
                  components={selectedTemplate.components}
                  mediaOverride={
                    campaignMediaOverride
                      ? {
                          mediaUrl: campaignMediaOverride.public_url,
                          filename: campaignMediaOverride.filename
                        }
                      : undefined
                  }
                  businessName={
                    selectedAccount?.verified_name ||
                    selectedAccount?.display_phone_number ||
                    "نشاطك التجاري"
                  }
                  templateName={selectedTemplate.name}
                />
              </div>
            )}
            {preflight && selectedContacts.length > 0 && (
              <div className="campaign-preflight-panel">
                <strong>فحص الجمهور قبل الإرسال</strong>
                <div className="campaign-preflight-stats">
                  <div><strong>{preflight.total}</strong><span>إجمالي</span></div>
                  <div><strong>{preflight.never_messaged}</strong><span>بدون محادثة</span></div>
                  <div><strong>{preflight.window_open}</strong><span>نافذة نشطة</span></div>
                  <div><strong>{preflight.window_closed}</strong><span>نافذة منتهية</span></div>
                </div>
                {preflight.warnings.map((warning) => (
                  <p key={warning} className="campaign-warning">⚠ {warning}</p>
                ))}
                {preflight.quality_rating && (
                  <p className="hint-text">جودة الحساب: {preflight.quality_rating}</p>
                )}
                <p className="hint-text">{preflight.messaging_tier_hint}</p>
              </div>
            )}
            {!approvedTemplates.length && (
              <p className="hint-text">لا توجد قوالب معتمدة — أضف من صفحة القوالب أو زامِن من Meta.</p>
            )}
            <button type="submit" className="whatsapp-button" disabled={!selectedContacts.length}>
              إنشاء وبدء الحملة ({selectedContacts.length})
            </button>
          </form>
        </div>

        <div className="campaigns-audience-panel">
          <div className="campaigns-audience-header">
            <h3 className="section-title-sm">جمهور من شريحة</h3>
            <div className="inline-actions">
              <select value={selectedSegmentId} onChange={(e) => setSelectedSegmentId(e.target.value)}>
                <option value="">اختر شريحة</option>
                {(segments.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <button type="button" className="secondary-button" disabled={!selectedSegmentId} onClick={() => void loadSegmentAudience()}>
                تحميل الشريحة
              </button>
            </div>
          </div>
          <div className="campaigns-audience-header">
            <h3 className="section-title-sm">اختيار العملاء يدوياً</h3>
            <label className="field-label campaigns-contact-search">
              <span>بحث</span>
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="اسم أو رقم…"
              />
            </label>
          </div>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedContacts(filteredContacts.map((c) => c.id))}
            >
              تحديد الكل
            </button>
            <button type="button" className="secondary-button" onClick={() => setSelectedContacts([])}>
              إلغاء التحديد
            </button>
          </div>
          <div className="contact-picker campaigns-contact-picker">
            {filteredContacts.map((item) => (
              <label key={item.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedContacts.includes(item.id)}
                  onChange={(e) => {
                    setSelectedContacts((current) =>
                      e.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id)
                    );
                  }}
                />
                <span>{item.display_name || item.external_address}</span>
                {item.display_name && <small dir="ltr">{item.external_address}</small>}
              </label>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
