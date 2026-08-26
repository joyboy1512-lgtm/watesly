import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { approveAndStartCampaign, computeCampaignStats } from "../lib/campaignHelpers";
import { type PreflightCheck } from "../lib/growthFeatures";
import {
  buildSendComponents,
  getTemplateHeaderInfo,
  HEADER_FORMAT_LABELS,
  HEADER_MEDIA_ACCEPT,
  type TemplateComponent
} from "../lib/templateMedia";
import { uploadFile, type UploadedFile } from "../lib/uploads";
import { downloadContactsImportTemplate, CAMPAIGN_AUDIENCE_LIMIT } from "../lib/contactHelpers";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import {
  AUDIENCE_GENDER_OPTIONS,
  buildAudienceResolvePayload,
  type AudienceGenderFilter,
  type InterestCategory
} from "../lib/interestHelpers";
import { toastStore } from "../stores/toast";
import {
  CampaignResultsTable,
  isActiveCampaignStatus,
  campaignReportNeedsRefresh,
  useCampaignActions,
  type CampaignReport,
  type CampaignSummaryRow
} from "../components/CampaignRecipientsPanel";

type Organization = { id: string; name: string };
type Channel = { id: string; name: string; type: string; organization_id: string };
type WhatsAppAccount = {
  id: string;
  channel_id: string;
  display_phone_number: string;
  verified_name: string | null;
  channel_name?: string | null;
};
type Template = {
  id: string;
  name: string;
  status: string;
  body_text: string | null;
  components: TemplateComponent[] | null;
  whatsapp_account_id: string;
};
type Contact = { id: string; display_name: string | null; external_address: string; channel_id: string };
type Segment = { id: string; name: string };
type CampaignPreflight = {
  total: number;
  never_messaged: number;
  window_open: number;
  window_closed: number;
  marketing_opt_in?: number;
  marketing_opt_out?: number;
  eligible_recipients?: number;
  reachable?: number;
  risky?: number;
  unreachable?: number;
  invalid_phone?: number;
  cold_audience?: number;
  warm_audience?: number;
  template_has_opt_out_button?: boolean;
  include_opt_out_option?: boolean;
  warnings: string[];
  messaging_tier_hint: string;
  quality_rating?: string | null;
  messaging_limit?: number | null;
  checks?: PreflightCheck[];
};
type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  template_id: string;
  whatsapp_account_id: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  report: CampaignReport & { pending: number; queued: number; skipped: number };
};
type ArchiveFilter = "active" | "archived";
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

type PageTab = "list" | "create" | "links";

function resolvePublicApiUrl(path: string) {
  if (path.startsWith("http")) return path;
  const base = api.defaults.baseURL ?? "http://localhost:8000/api/v1";
  const origin = base.replace(/\/api\/v1\/?$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

async function waitForCampaignReport(
  client: ReturnType<typeof useQueryClient>,
  campaignId: string
) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await client.refetchQueries({ queryKey: ["campaigns"] });
    await client.refetchQueries({ queryKey: ["campaign-report", campaignId] });
    const rows = client.getQueryData<CampaignListItem[]>(["campaigns"]);
    const item = rows?.find((row) => row.id === campaignId);
    if (item) {
      const sent = item.report.sent + item.report.delivered + item.report.read;
      if (sent > 0 || item.report.failed > 0) return;
      if (isActiveCampaignStatus(item.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        continue;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
}

export default function CampaignsPage() {
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const createRef = useRef<HTMLElement | null>(null);
  const {
    pauseCampaign,
    cancelCampaign,
    archiveCampaign,
    unarchiveCampaign,
    deleteDraftCampaign,
    startDraftCampaign
  } = useCampaignActions();

  const [activeTab, setActiveTab] = useState<PageTab>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

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
  const [audienceGenderFilter, setAudienceGenderFilter] = useState<AudienceGenderFilter>("");
  const [audienceInterestIds, setAudienceInterestIds] = useState<string[]>([]);
  const [audienceLifecycle, setAudienceLifecycle] = useState("");
  const [preflight, setPreflight] = useState<CampaignPreflight | null>(null);
  const [includeOptOutOption, setIncludeOptOutOption] = useState(true);
  const [excludeUnreachable, setExcludeUnreachable] = useState(true);
  const [excludeRisky, setExcludeRisky] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [linkCampaignId, setLinkCampaignId] = useState("");

  const organizations = useQuery({ queryKey: ["organizations"], queryFn: async () => (await api.get<Organization[]>("/organizations")).data });
  const channels = useQuery({ queryKey: ["channels"], queryFn: async () => (await api.get<Channel[]>("/channels")).data });
  const accounts = useQuery({ queryKey: ["whatsapp-accounts"], queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data });
  const templates = useQuery({ queryKey: ["templates"], queryFn: async () => (await api.get<Template[]>("/templates")).data });
  const audienceChannelId = useMemo(() => {
    const account = (accounts.data ?? []).find((item) => item.id === accountId);
    return account?.channel_id || channelId || "";
  }, [accounts.data, accountId, channelId]);
  const contacts = useQuery({
    queryKey: ["contacts", "campaign-audience", organizationId, audienceChannelId],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: CAMPAIGN_AUDIENCE_LIMIT };
      if (organizationId) params.organization_id = organizationId;
      if (audienceChannelId) params.channel_id = audienceChannelId;
      return (await api.get<Contact[]>("/contacts", { params })).data;
    },
    enabled: Boolean(organizationId)
  });
  const segments = useQuery({
    queryKey: ["segments"],
    queryFn: async () => (await api.get<Segment[]>("/platform/segments")).data
  });
  const interests = useQuery({
    queryKey: ["interests"],
    queryFn: async () => (await api.get<InterestCategory[]>("/platform/interests")).data
  });

  const campaigns = useQuery({
    queryKey: ["campaigns", archiveFilter],
    queryFn: async () => {
      const params = archiveFilter === "archived" ? { archived_only: true } : {};
      return (await api.get<CampaignListItem[]>("/campaigns", { params })).data;
    },
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      if (rows.some((item) => isActiveCampaignStatus(item.status))) return 3000;
      if (rows.some((item) => campaignReportNeedsRefresh({
        status: item.status,
        completed_at: item.completed_at,
        total: item.report.total,
        sent: item.report.sent,
        delivered: item.report.delivered,
        read: item.report.read,
        failed: item.report.failed
      }))) return 3000;
      return false;
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

  const templateMap = useMemo(
    () => new Map((templates.data ?? []).map((item) => [item.id, item.name])),
    [templates.data]
  );
  const accountMap = useMemo(
    () => new Map(
      (accounts.data ?? []).map((item) => [
        item.id,
        item.verified_name || item.display_phone_number
      ])
    ),
    [accounts.data]
  );

  const campaignRows = useMemo<CampaignSummaryRow[]>(
    () => (campaigns.data ?? []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      scheduled_at: campaign.scheduled_at,
      started_at: campaign.started_at,
      completed_at: campaign.completed_at,
      archived_at: campaign.archived_at,
      template_name: templateMap.get(campaign.template_id) ?? null,
      account_label: accountMap.get(campaign.whatsapp_account_id) ?? null,
      total: campaign.report.total,
      sent: campaign.report.sent,
      delivered: campaign.report.delivered,
      read: campaign.report.read,
      failed: campaign.report.failed,
      pending: campaign.report.pending
    })),
    [campaigns.data, templateMap, accountMap]
  );

  const stats = useMemo(() => computeCampaignStats(campaignRows), [campaignRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaignRows.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (!term) return true;
      const haystack = `${item.name} ${item.template_name ?? ""} ${item.account_label ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [campaignRows, search, statusFilter]);

  useEffect(() => {
    if (!highlightCampaignId) return;
    const timer = window.setTimeout(() => setHighlightCampaignId(null), 8000);
    return () => window.clearTimeout(timer);
  }, [highlightCampaignId]);

  useEffect(() => {
    if (searchParams.get("action") === "create") {
      setActiveTab("create");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const orgs = organizations.data ?? [];
    if (!organizationId && orgs.length === 1) {
      setOrganizationId(orgs[0].id);
    }
  }, [organizations.data, organizationId]);

  useEffect(() => {
    const idsParam = searchParams.get("contact_ids");
    if (!idsParam) return;
    const ids = idsParam.split(",").map((item) => item.trim()).filter(Boolean);
    if (ids.length > 0) {
      setSelectedContacts(ids);
      setActiveTab("create");
    }
  }, [searchParams]);

  const orgChannels = (channels.data ?? []).filter((item) => !organizationId || item.organization_id === organizationId);
  const approvedTemplates = (templates.data ?? []).filter((item) => item.status === "approved");
  const accountTemplates = useMemo(
    () => approvedTemplates.filter((item) => !accountId || item.whatsapp_account_id === accountId),
    [approvedTemplates, accountId]
  );
  const selectedTemplate = useMemo(
    () => accountTemplates.find((item) => item.id === templateId) ?? null,
    [accountTemplates, templateId]
  );
  const templateHeader = useMemo(
    () => getTemplateHeaderInfo(selectedTemplate?.components),
    [selectedTemplate]
  );
  const selectedAccount = useMemo(
    () => (accounts.data ?? []).find((item) => item.id === accountId) ?? null,
    [accounts.data, accountId]
  );
  const selectedAccountChannelId = selectedAccount?.channel_id ?? "";
  const contactById = useMemo(
    () => new Map((contacts.data ?? []).map((item) => [item.id, item])),
    [contacts.data]
  );
  const filteredContacts = (contacts.data ?? []).filter((item) => {
    if (selectedAccountChannelId && item.channel_id !== selectedAccountChannelId) return false;
    if (!contactSearch.trim()) return true;
    const term = contactSearch.trim().toLowerCase();
    return (
      item.external_address.toLowerCase().includes(term) ||
      (item.display_name ?? "").toLowerCase().includes(term)
    );
  });
  const channelScopedSelectedContacts = useMemo(() => {
    if (!selectedAccountChannelId) return selectedContacts;
    return selectedContacts.filter((id) => {
      const contact = contactById.get(id);
      if (!contact) return true;
      return contact.channel_id === selectedAccountChannelId;
    });
  }, [selectedContacts, selectedAccountChannelId, contactById]);
  const hiddenSelectedCount = selectedContacts.length - channelScopedSelectedContacts.length;
  const visibleSelectedCount = filteredContacts.filter((item) =>
    channelScopedSelectedContacts.includes(item.id)
  ).length;

  useEffect(() => {
    if (!accountId) return;
    const account = (accounts.data ?? []).find((item) => item.id === accountId);
    if (account?.channel_id) setChannelId(account.channel_id);
    if (templateId) {
      const template = approvedTemplates.find((item) => item.id === templateId);
      if (template && template.whatsapp_account_id !== accountId) {
        setTemplateId("");
        setCampaignMediaOverride(null);
      }
    }
  }, [accountId, accounts.data, approvedTemplates, templateId]);

  useEffect(() => {
    if (!selectedAccountChannelId) return;
    setSelectedContacts((current) => {
      const pruned = current.filter(
        (id) => contactById.get(id)?.channel_id === selectedAccountChannelId
      );
      return pruned.length === current.length ? current : pruned;
    });
  }, [selectedAccountChannelId, contactById]);

  useEffect(() => {
    if (!templateId || !channelScopedSelectedContacts.length) {
      setPreflight(null);
      return;
    }
    void api
      .post("/campaigns/preflight", {
        template_id: templateId,
        contact_ids: channelScopedSelectedContacts,
        whatsapp_account_id: accountId || null,
        include_opt_out_option: includeOptOutOption,
        exclude_unreachable: excludeUnreachable,
        exclude_risky: excludeRisky
      })
      .then((res) => setPreflight(res.data as CampaignPreflight))
      .catch(() => setPreflight(null));
  }, [templateId, channelScopedSelectedContacts, accountId, includeOptOutOption, excludeUnreachable, excludeRisky]);

  function onOrganizationChange(value: string) {
    setOrganizationId(value);
    setChannelId("");
    setSelectedContacts([]);
    setPreflight(null);
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
      const result = await api.post<{
        contact_ids?: string[];
        created: number;
        existing: number;
        skipped?: number;
        invalid?: number;
      }>("/campaigns/import-audience", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 300000
      });
      const ids: string[] = result.data.contact_ids ?? [];
      setSelectedContacts(ids);
      const skipped = result.data.skipped ?? 0;
      const invalid = result.data.invalid ?? 0;
      toastStore.getState().show(
        `تم تحميل ${ids.length} عميل للحملة (${result.data.created} جديد، ${result.data.existing} موجود${invalid ? `، ${invalid} رقم غير صالح` : ""}${skipped ? `، ${skipped} فارغ` : ""}).`,
        "success"
      );
      await client.invalidateQueries({ queryKey: ["contacts"] });
      event.currentTarget.reset();
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر استيراد ملف العملاء. استخدم Excel (.xlsx) أو CSV."), "error");
    }
  }

  async function createFollowUp(campaignId: string, followUpType: "not_delivered" | "not_read" | "failed") {
    setActionBusyId(campaignId);
    const requestOptions = { skipGlobalErrorToast: true } as const;
    try {
      const response = await api.post(
        `/campaigns/${campaignId}/follow-up`,
        { follow_up_type: followUpType },
        requestOptions
      );
      const followUpId = response.data.id as string;
      setExpandedCampaignId(followUpId);
      setHighlightCampaignId(followUpId);
      setActiveTab("list");
      try {
        await approveAndStartCampaign(followUpId, requestOptions);
        await waitForCampaignReport(client, followUpId);
        toastStore.getState().show("تم بدء حملة المتابعة — تظهر النتيجة في الجدول.", "success");
      } catch (startError) {
        toastStore.getState().show(
          formatApiError(
            startError,
            "تم إنشاء مسودة المتابعة — اضغط «اعتماد وإرسال» في الجدول أو اطلب اعتمادًا من المدير."
          ),
          "error"
        );
      }
      await client.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (error) {
      toastStore.getState().show(
        formatApiError(error, "تعذر إنشاء المتابعة. فعّل «حملات متابعة» من Developer → ميزات Watesly."),
        "error"
      );
    } finally {
      setActionBusyId(null);
    }
  }

  async function handlePause(campaignId: string) {
    setActionBusyId(campaignId);
    await pauseCampaign(campaignId);
    setActionBusyId(null);
  }

  async function handleCancel(campaignId: string) {
    setActionBusyId(campaignId);
    await cancelCampaign(campaignId);
    setActionBusyId(null);
  }

  async function handleArchive(campaignId: string) {
    setActionBusyId(campaignId);
    await archiveCampaign(campaignId);
    setActionBusyId(null);
  }

  async function handleUnarchive(campaignId: string) {
    setActionBusyId(campaignId);
    await unarchiveCampaign(campaignId);
    setActionBusyId(null);
  }

  async function handleDeleteDraft(campaignId: string) {
    setActionBusyId(campaignId);
    await deleteDraftCampaign(campaignId);
    setActionBusyId(null);
  }

  async function loadSegmentAudience() {
    if (!selectedSegmentId) return;
    try {
      const params: Record<string, string> = {};
      if (selectedAccountChannelId) params.channel_id = selectedAccountChannelId;
      const result = await api.get<{ id: string }[]>(
        `/platform/segments/${selectedSegmentId}/contacts`,
        { params }
      );
      const ids = result.data.map((item) => item.id);
      setSelectedContacts(ids);
      toastStore.getState().show(`تم تحميل ${ids.length} عميل من الشريحة.`, "success");
    } catch {
      toastStore.getState().show("تعذر تحميل الشريحة.", "error");
    }
  }

  function toggleAudienceInterest(interestId: string) {
    setAudienceInterestIds((current) =>
      current.includes(interestId) ? current.filter((id) => id !== interestId) : [...current, interestId]
    );
  }

  async function applyAudienceFilter() {
    if (!organizationId) {
      toastStore.getState().show("اختر الفرع في نموذج الحملة أولاً.", "error");
      return;
    }
    const audienceChannelId = selectedAccountChannelId || channelId;
    if (!audienceChannelId) {
      toastStore.getState().show("اختر حساب WhatsApp أو القناة قبل تحميل الجمهور.", "error");
      return;
    }
    const hasAudienceFilter = Boolean(
      audienceGenderFilter || audienceInterestIds.length > 0 || audienceLifecycle
    );
    if (!hasAudienceFilter) {
      toastStore.getState().show(
        "اختر اهتماماً أو جنساً أو مرحلة العميل — لا يُحمَّل كل العملاء تلقائياً.",
        "error"
      );
      return;
    }
    try {
      const payload = buildAudienceResolvePayload({
        organizationId,
        channelId: audienceChannelId,
        genderFilter: audienceGenderFilter,
        interestIds: audienceInterestIds,
        lifecycleStage: audienceLifecycle || undefined,
        marketingOptInOnly: true
      });
      const result = await api.post<{
        count: number;
        contact_ids: string[];
        warnings: string[];
      }>("/platform/audience/resolve", payload);
      setSelectedContacts(result.data.contact_ids ?? []);
      toastStore.getState().show(`تم تحميل ${result.data.count} عميل مطابق للفلتر.`, "success");
    } catch {
      toastStore.getState().show("تعذر تطبيق فلتر الجمهور.", "error");
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
    if (!organizationId) {
      toastStore.getState().show("اختر الفرع أولاً.", "error");
      return;
    }
    if (!accountId || !templateId) {
      toastStore.getState().show("اختر حساب WhatsApp والقالب المعتمد.", "error");
      return;
    }
    if (!channelScopedSelectedContacts.length) {
      toastStore.getState().show("اختر عملاء للحملة على قناة WhatsApp المحددة.", "error");
      return;
    }
    if (templateHeader && !templateHeader.mediaUrl && !campaignMediaOverride) {
      toastStore.getState().show("القالب يتطلب وسائط في الرأس — ارفع صورة أو فيديو أو PDF.", "error");
      return;
    }
    const requestOptions = { skipGlobalErrorToast: true } as const;
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
        include_opt_out_option: includeOptOutOption,
        exclude_marketing_opt_out: true,
        exclude_unreachable: excludeUnreachable,
        exclude_risky: excludeRisky,
        recipients: channelScopedSelectedContacts.map((contact_id) => ({
          contact_id,
          template_parameters: templateParameters
        }))
      }, requestOptions);
      const campaignId = response.data.id as string;
      await approveAndStartCampaign(campaignId, requestOptions);
      setName("");
      setSelectedContacts([]);
      setCampaignMediaOverride(null);
      setExpandedCampaignId(campaignId);
      setHighlightCampaignId(campaignId);
      setActiveTab("list");
      await waitForCampaignReport(client, campaignId);
      toastStore.getState().show("تم بدء الحملة — تظهر النتيجة في الجدول.", "success");
    } catch (error) {
      toastStore.getState().show(
        formatApiError(error, "تعذر إنشاء الحملة. تحقق من القالب المعتمد، أو أن الجمهور لم يرفض التسويق."),
        "error"
      );
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
        <div>
          <span className="eyebrow whatsapp-eyebrow">WhatsApp Business API</span>
          <h1>حملات WhatsApp</h1>
          <p>جدول موحّد لكل حملة — الحالة، النتائج، التسليم، والإجراءات في صف واحد.</p>
        </div>
        <Link to="/templates" className="secondary-button">القوالب ←</Link>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand"><span>إجمالي الحملات</span><strong>{stats.total}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>قيد الإرسال</span><strong>{stats.running}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>مكتملة</span><strong>{stats.completed}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>فشلت</span><strong>{stats.failed}</strong></article>
        <article className="admin-stat-card admin-stat-card-brand"><span>مسودات</span><strong>{stats.draft}</strong></article>
      </section>

      <div className="campaigns-page-tabs">
        <button
          type="button"
          className={activeTab === "list" ? "campaigns-tab active" : "campaigns-tab"}
          onClick={() => setActiveTab("list")}
        >
          جدول الحملات
        </button>
        <button
          type="button"
          className={activeTab === "create" ? "campaigns-tab active" : "campaigns-tab"}
          onClick={() => setActiveTab("create")}
        >
          إنشاء حملة
        </button>
        <button
          type="button"
          className={activeTab === "links" ? "campaigns-tab active" : "campaigns-tab"}
          onClick={() => setActiveTab("links")}
        >
          روابط التتبع
        </button>
      </div>

      {activeTab === "list" && (
        <section className={`card admin-table-card${highlightCampaignId ? " campaigns-list-highlight" : ""}`}>
          <div className="admin-table-header">
            <div>
              <h2>{archiveFilter === "archived" ? "أرشيف الحملات" : "جدول الحملات"}</h2>
              <small>
                {filteredRows.length} حملة ·{" "}
                {archiveFilter === "archived"
                  ? "حملات مؤرشفة — اضغط «استعادة» لإرجاعها للقائمة النشطة"
                  : "الحملات المنتهية يمكن أرشفتها من عمود الإجراءات أو من التقرير"}
              </small>
            </div>
          </div>

          <div className="inline-actions" style={{ padding: "12px 16px 0" }}>
            <button
              type="button"
              className={archiveFilter === "active" ? "whatsapp-button compact" : "secondary-button compact"}
              onClick={() => setArchiveFilter("active")}
            >
              الحملات النشطة
            </button>
            <button
              type="button"
              className={archiveFilter === "archived" ? "whatsapp-button compact" : "secondary-button compact"}
              onClick={() => setArchiveFilter("archived")}
            >
              الأرشيف
            </button>
          </div>

          <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو القالب أو الحساب…"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">كل الحالات</option>
              <option value="running">قيد الإرسال</option>
              <option value="scheduled">مجدولة</option>
              <option value="completed">مكتملة</option>
              <option value="completed_with_errors">مكتملة بأخطاء</option>
              <option value="failed">فشلت</option>
              <option value="paused">موقوفة</option>
              <option value="draft">مسودة</option>
              <option value="cancelled">ملغاة</option>
            </select>
          </div>

          {campaigns.isLoading && <p className="hint-text" style={{ padding: "12px 16px" }}>جاري تحميل الحملات…</p>}
          {campaigns.isError && <p className="hint-text" style={{ padding: "12px 16px" }}>تعذر تحميل الحملات.</p>}
          {!campaigns.isLoading && !campaigns.isError && (
            <CampaignResultsTable
              items={filteredRows}
              expandedCampaignId={expandedCampaignId}
              onToggleExpanded={(id) => setExpandedCampaignId((current) => (current === id ? null : id))}
              autoRefresh
              emptyLabel={
                archiveFilter === "archived"
                  ? "لا توجد حملات مؤرشفة."
                  : "لا توجد حملات بعد. أنشئ حملة من تبويب «إنشاء حملة»."
              }
              actions={{
                onFollowUp: archiveFilter === "active" ? createFollowUp : undefined,
                onPause: handlePause,
                onCancel: handleCancel,
                onArchive: handleArchive,
                onUnarchive: handleUnarchive,
                onDeleteDraft: handleDeleteDraft,
                onStartDraft: archiveFilter === "active" ? startDraftCampaign : undefined,
                showArchived: archiveFilter === "archived",
                actionBusyId
              }}
            />
          )}
        </section>
      )}

      {activeTab === "create" && (
        <section ref={createRef} className="card campaigns-manage-card">
          <div className="admin-table-header">
            <div>
              <h2>إنشاء حملة جديدة</h2>
              <small>قالب معتمد · جمهور · فحص مسبق · إرسال فوري</small>
            </div>
          </div>

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
              <p className="hint-text">
                الأعمدة: <strong dir="ltr">phone</strong> (إلزامي) · <strong dir="ltr">name</strong> · <strong dir="ltr">language</strong> (ar/en)
              </p>
              <div className="admin-actions compact">
                <button type="submit" disabled={!organizationId || !channelId}>تحميل العملاء</button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void downloadContactsImportTemplate().catch(() => toastStore.getState().show("تعذر تحميل القالب.", "error"))}
                >
                  تحميل قالب Excel
                </button>
              </div>
              {channelScopedSelectedContacts.length > 0 && (
                <p className="hint-text">✓ {channelScopedSelectedContacts.length} عميل محدّد للحملة</p>
              )}
              {hiddenSelectedCount > 0 && (
                <p className="hint-text campaigns-audience-warning" role="alert">
                  ⚠ {hiddenSelectedCount} عميل محدّد من قناة أخرى — تم استبعادهم تلقائياً من الإرسال.
                </p>
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
                <select
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setTemplateId("");
                    setCampaignMediaOverride(null);
                    setPreflight(null);
                  }}
                  required
                >
                  <option value="">اختر الحساب</option>
                  {(accounts.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.channel_name ? `${item.channel_name} · ` : ""}
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
                  disabled={!accountId}
                >
                  <option value="">
                    {accountId ? "اختر القالب" : "اختر حساب WhatsApp أولاً"}
                  </option>
                  {accountTemplates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              {accountId && accountTemplates.length === 0 && (
                <p className="hint-text campaign-warning">
                  لا توجد قوالب معتمدة لهذا الحساب. افتح{" "}
                  <Link to="/templates">صفحة القوالب</Link>
                  {" "}→ تبويب «مزامنة من Meta» → اختر نفس الحساب → Sync.
                </p>
              )}
              {accountId && templateId && selectedAccount && selectedTemplate && selectedTemplate.whatsapp_account_id !== accountId && (
                <p className="hint-text campaign-warning">
                  هذا القالب لا ينتمي للحساب المختار — اختر قالباً من نفس القناة.
                </p>
              )}
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
              {preflight && channelScopedSelectedContacts.length > 0 && (
                <div className="campaign-preflight-panel">
                  <strong>فحص الجمهور قبل الإرسال</strong>
                  <div className="campaign-preflight-stats">
                    <div><strong>{preflight.total}</strong><span>إجمالي</span></div>
                    <div><strong>{preflight.eligible_recipients ?? preflight.marketing_opt_in ?? preflight.total}</strong><span>مؤهل للإرسال</span></div>
                    <div><strong>{preflight.reachable ?? 0}</strong><span>قابل للوصول</span></div>
                    <div><strong>{preflight.unreachable ?? 0}</strong><span>غير قابل</span></div>
                    <div><strong>{preflight.risky ?? 0}</strong><span>محفوف بالمخاطر</span></div>
                    <div><strong>{preflight.marketing_opt_out ?? 0}</strong><span>عدم الإزعاج</span></div>
                    <div><strong>{preflight.cold_audience ?? preflight.never_messaged}</strong><span>بدون تفاعل</span></div>
                    <div><strong>{preflight.warm_audience ?? preflight.window_open + preflight.window_closed}</strong><span>تفاعل سابق</span></div>
                  </div>
                  {preflight.warnings.map((warning) => (
                    <p key={warning} className="campaign-warning">⚠ {warning}</p>
                  ))}
                  {(preflight.checks ?? []).map((check) => (
                    <p
                      key={check.code}
                      className={
                        check.level === "error"
                          ? "campaign-warning"
                          : check.level === "warning"
                            ? "campaign-warning"
                            : "hint-text"
                      }
                    >
                      {check.level === "info" ? "ℹ" : "⚠"} {check.message}
                    </p>
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
              <label className="field-label checkbox-inline">
                <input
                  type="checkbox"
                  checked={includeOptOutOption}
                  onChange={(event) => setIncludeOptOutOption(event.target.checked)}
                />
                <span>إظهار خيار «عدم الإزعاج» للعملاء واستبعاد من اختاروه تلقائياً</span>
              </label>
              <label className="field-label checkbox-inline">
                <input
                  type="checkbox"
                  checked={excludeUnreachable}
                  onChange={(event) => setExcludeUnreachable(event.target.checked)}
                />
                <span>استبعاد العملاء غير القابلين للوصول (فشل سابق أو رقم غير صالح)</span>
              </label>
              <label className="field-label checkbox-inline">
                <input
                  type="checkbox"
                  checked={excludeRisky}
                  onChange={(event) => setExcludeRisky(event.target.checked)}
                />
                <span>استبعاد العملاء بدون تفاعل سابق (محفوف بالمخاطر)</span>
              </label>
              <button
                type="submit"
                className="whatsapp-button"
                disabled={!channelScopedSelectedContacts.length || preflight?.eligible_recipients === 0}
              >
                إنشاء وبدء الحملة ({preflight?.eligible_recipients ?? channelScopedSelectedContacts.length})
              </button>
            </form>
          </div>

          <div className="campaigns-audience-panel">
            <div className="campaigns-audience-header">
              <h3 className="section-title-sm">استهداف حسب الاهتمام والجنس</h3>
              <p className="hint-text">
                اختر الاهتمامات ثم حدّد الجنس من القائمة إذا لزم (مثل حملة تجميل → استبعاد الرجال).
              </p>
            </div>
            <div className="campaign-audience-filters">
              <label className="field-label">
                <span>الجنس</span>
                <select value={audienceGenderFilter} onChange={(e) => setAudienceGenderFilter(e.target.value as AudienceGenderFilter)}>
                  {AUDIENCE_GENDER_OPTIONS.map((item) => (
                    <option key={item.value || "all"} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                <span>مرحلة العميل</span>
                <select value={audienceLifecycle} onChange={(e) => setAudienceLifecycle(e.target.value)}>
                  <option value="">كل المراحل</option>
                  <option value="lead">عميل محتمل</option>
                  <option value="prospect">مهتم</option>
                  <option value="customer">عميل</option>
                  <option value="churned">متوقف</option>
                </select>
              </label>
            </div>
            <div className="field-label">
              <span>الاهتمامات</span>
              <div className="contacts-tags-cell">
                {(interests.data ?? []).map((interest) => {
                  const active = audienceInterestIds.includes(interest.id);
                  return (
                    <button
                      key={interest.id}
                      type="button"
                      className={`contacts-tag-chip ${active ? "contacts-tag-chip-active" : ""}`}
                      onClick={() => toggleAudienceInterest(interest.id)}
                    >
                      {interest.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button type="button" className="contacts-erp-btn contacts-erp-btn-primary" onClick={() => void applyAudienceFilter()}>
              تطبيق الفلتر وتحميل الجمهور
            </button>

            <div className="campaigns-audience-header" style={{ marginTop: 18 }}>
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
                تحديد الكل ({filteredContacts.length})
              </button>
              <button type="button" className="secondary-button" onClick={() => setSelectedContacts([])}>
                إلغاء التحديد
              </button>
              {channelScopedSelectedContacts.length > 0 && (
                <span className="hint-text">
                  {visibleSelectedCount} ظاهر · {channelScopedSelectedContacts.length} للإرسال
                </span>
              )}
            </div>
            {(contacts.data?.length ?? 0) >= CAMPAIGN_AUDIENCE_LIMIT && (
              <p className="hint-text campaigns-audience-warning" role="status">
                يُعرض حتى {CAMPAIGN_AUDIENCE_LIMIT.toLocaleString("ar")} عميل في القائمة — للجمهور الأكبر استخدم استيراد Excel أعلاه.
              </p>
            )}
            <div className="contact-picker campaigns-contact-picker">
              {filteredContacts.map((item) => (
                <label key={item.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={channelScopedSelectedContacts.includes(item.id)}
                    onChange={(e) => {
                      setSelectedContacts((current) => {
                        const scoped = selectedAccountChannelId
                          ? current.filter((id) => contactById.get(id)?.channel_id === selectedAccountChannelId)
                          : current;
                        return e.target.checked
                          ? [...scoped, item.id]
                          : scoped.filter((id) => id !== item.id);
                      });
                    }}
                  />
                  <span>{item.display_name || item.external_address}</span>
                  {item.display_name && <small dir="ltr">{item.external_address}</small>}
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === "links" && (
        <section className="card admin-table-card">
          <div className="admin-table-header">
            <div>
              <h2>روابط تتبع wa.me</h2>
              <small>رابط قصير يُحسب عليه النقر ثم يُحوّل إلى WhatsApp</small>
            </div>
          </div>

          <form className="stack-form campaigns-actions-grid" style={{ padding: "0 16px" }} onSubmit={(e) => void createTrackedLink(e)}>
            <label className="field-label">
              <span>اسم الرابط</span>
              <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="عرض رمضان" required />
            </label>
            <label className="field-label">
              <span>رسالة مسبقة (اختياري)</span>
              <input value={linkMessage} onChange={(e) => setLinkMessage(e.target.value)} placeholder="مرحباً، أريد العرض" />
            </label>
            <label className="field-label">
              <span>حساب WhatsApp</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">اختر الحساب</option>
                {(accounts.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.verified_name || item.display_phone_number}
                  </option>
                ))}
              </select>
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
            <button type="submit" className="secondary-button" disabled={!linkName.trim() || !accountId}>
              إنشاء رابط
            </button>
          </form>

          {trackedLinks.isLoading && <p className="hint-text" style={{ padding: "12px 16px" }}>جاري تحميل الروابط…</p>}
          {(trackedLinks.data ?? []).length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-erp-table">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>نقرات</th>
                    <th>رابط التتبع</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {(trackedLinks.data ?? []).map((item) => {
                    const trackFull = resolvePublicApiUrl(item.track_url);
                    return (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td>{item.click_count.toLocaleString("ar")}</td>
                        <td><code dir="ltr">{trackFull}</code></td>
                        <td>
                          <div className="admin-actions campaign-row-actions">
                            <button type="button" className="secondary-button compact" onClick={() => void copyText(trackFull, "رابط التتبع")}>
                              نسخ التتبع
                            </button>
                            <button type="button" className="secondary-button compact" onClick={() => void copyText(item.wa_me_url, "wa.me")}>
                              نسخ wa.me
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            !trackedLinks.isLoading && <p className="admin-table-empty">لا توجد روابط تتبع بعد.</p>
          )}
        </section>
      )}
    </main>
  );
}
