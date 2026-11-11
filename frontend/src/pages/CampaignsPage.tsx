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
import {
  CAMPAIGN_AUDIENCE_LIMIT,
  downloadContactsImportTemplate,
  formatContactDate,
  formatWhatsAppStatus,
  WHATSAPP_STATUS_LABELS,
  whatsappStatusTone,
  type Contact as ContactRow,
  type Tag
} from "../lib/contactHelpers";
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
type Contact = ContactRow;
type Segment = { id: string; name: string };
type AudienceMode = "library" | "excel";
type CampaignPeriodGroup = {
  id: string;
  name: string;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  sent_count: number;
  first_sent_at: string | null;
  last_sent_at: string | null;
};
type CampaignPreflight = {
  total: number;
  never_messaged: number;
  previously_sent?: number;
  never_sent?: number;
  never_sent_contact_ids?: string[];
  sent_in_period?: number;
  sent_in_period_contact_ids?: string[];
  kept_after_period_exclude_contact_ids?: string[];
  campaigns_in_period?: CampaignPeriodGroup[];
  exclude_sent_in_period?: boolean;
  selected_after_isolation?: number;
  only_never_sent?: boolean;
  window_open: number;
  window_closed: number;
  marketing_opt_in?: number;
  marketing_opt_out?: number;
  eligible_recipients?: number;
  eligible_contact_ids?: string[];
  invalid_phone?: number;
  reachable?: number;
  risky?: number;
  unreachable?: number;
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
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("library");
  const [excelAudienceIds, setExcelAudienceIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [audienceTagIds, setAudienceTagIds] = useState<string[]>([]);
  const [audienceTagMenuOpen, setAudienceTagMenuOpen] = useState(false);
  const audienceTagMenuRef = useRef<HTMLDivElement | null>(null);
  const [audienceWhatsappStatus, setAudienceWhatsappStatus] = useState("");
  const [audienceRegions, setAudienceRegions] = useState<string[]>([]);
  const [audienceRegionMenuOpen, setAudienceRegionMenuOpen] = useState(false);
  const audienceRegionMenuRef = useRef<HTMLDivElement | null>(null);
  const [audienceSegmentFilterId, setAudienceSegmentFilterId] = useState("");
  const [audienceLastCampaignFrom, setAudienceLastCampaignFrom] = useState("");
  const [audienceLastCampaignTo, setAudienceLastCampaignTo] = useState("");
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
  const [onlyNeverSent, setOnlyNeverSent] = useState(false);
  const [excludeSentInPeriod, setExcludeSentInPeriod] = useState(false);
  const [excludeSentFrom, setExcludeSentFrom] = useState("");
  const [excludeSentTo, setExcludeSentTo] = useState("");
  const [excludeCampaignIds, setExcludeCampaignIds] = useState<string[]>([]);
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
    queryKey: [
      "contacts",
      "campaign-audience",
      organizationId,
      audienceChannelId,
      audienceMode,
      excelAudienceIds,
      audienceTagIds,
      audienceWhatsappStatus,
      audienceRegions,
      audienceSegmentFilterId
    ],
    queryFn: async () => {
      const base: Record<string, string | number> = { limit: CAMPAIGN_AUDIENCE_LIMIT };
      if (organizationId) base.organization_id = organizationId;
      if (audienceChannelId) base.channel_id = audienceChannelId;
      if (audienceMode === "excel" && excelAudienceIds.length > 0) {
        const chunkSize = 80;
        const rows: Contact[] = [];
        const seen = new Set<string>();
        for (let index = 0; index < excelAudienceIds.length; index += chunkSize) {
          const chunk = excelAudienceIds.slice(index, index + chunkSize);
          const batch = (
            await api.get<Contact[]>("/contacts", {
              params: {
                ...base,
                ids: chunk.join(","),
                limit: chunk.length
              }
            })
          ).data;
          for (const item of batch) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            rows.push(item);
          }
        }
        return rows;
      }
      if (audienceTagIds.length === 1) base.tag_id = audienceTagIds[0];
      if (audienceTagIds.length > 1) base.tag_ids = audienceTagIds.join(",");
      if (audienceWhatsappStatus) base.whatsapp_status = audienceWhatsappStatus;
      if (audienceRegions.length === 1) base.region = audienceRegions[0];
      if (audienceRegions.length > 1) base.regions = audienceRegions.join(",");
      if (audienceSegmentFilterId) base.segment_id = audienceSegmentFilterId;
      return (await api.get<Contact[]>("/contacts", { params: base })).data;
    },
    enabled: Boolean(organizationId) && (audienceMode !== "excel" || excelAudienceIds.length > 0)
  });
  const contactRegions = useQuery({
    queryKey: ["contact-regions", organizationId, audienceChannelId],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (organizationId) params.organization_id = organizationId;
      if (audienceChannelId) params.channel_id = audienceChannelId;
      return (await api.get<Array<{ region: string; count: number }>>("/contacts/regions", { params })).data;
    },
    enabled: Boolean(organizationId)
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: async () => (await api.get<Tag[]>("/inbox-tools/tags")).data
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
    if (!audienceTagMenuOpen) return;
    function onDocClick(event: MouseEvent) {
      if (audienceTagMenuRef.current && !audienceTagMenuRef.current.contains(event.target as Node)) {
        setAudienceTagMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [audienceTagMenuOpen]);

  useEffect(() => {
    if (!audienceRegionMenuOpen) return;
    function onDocClick(event: MouseEvent) {
      if (audienceRegionMenuRef.current && !audienceRegionMenuRef.current.contains(event.target as Node)) {
        setAudienceRegionMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [audienceRegionMenuOpen]);

  const organizationTags = useMemo(
    () =>
      (tags.data ?? []).filter((tag) => !organizationId || tag.organization_id === organizationId),
    [tags.data, organizationId]
  );
  const selectedAudienceTags = useMemo(
    () => organizationTags.filter((tag) => audienceTagIds.includes(tag.id)),
    [organizationTags, audienceTagIds]
  );
  const availableRegions = useMemo(
    () => (contactRegions.data ?? []).map((item) => item.region),
    [contactRegions.data]
  );
  const regionCountByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of contactRegions.data ?? []) map.set(item.region, item.count);
    return map;
  }, [contactRegions.data]);

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
  const excelIdSet = useMemo(() => new Set(excelAudienceIds), [excelAudienceIds]);
  const filteredContacts = useMemo(() => {
    const from = audienceLastCampaignFrom ? new Date(`${audienceLastCampaignFrom}T00:00:00`) : null;
    const to = audienceLastCampaignTo ? new Date(`${audienceLastCampaignTo}T23:59:59`) : null;
    const term = contactSearch.trim().toLowerCase();
    return (contacts.data ?? []).filter((item) => {
      if (audienceMode === "excel" && !excelIdSet.has(item.id)) return false;
      if (selectedAccountChannelId && item.channel_id !== selectedAccountChannelId) return false;
      if (audienceMode === "excel" && audienceWhatsappStatus) {
        const status = item.whatsapp_status ?? (item.marketing_opt_in === false ? "dnd" : "accepts");
        if (status !== audienceWhatsappStatus) return false;
      }
      if (audienceRegions.length > 0 && !audienceRegions.includes(item.region || "")) return false;
      if (term) {
        const hay = `${item.display_name ?? ""} ${item.external_address} ${item.region ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (from || to) {
        if (!item.last_campaign_at) return false;
        const at = new Date(item.last_campaign_at);
        if (from && at < from) return false;
        if (to && at > to) return false;
      }
      return true;
    });
  }, [
    contacts.data,
    audienceMode,
    excelIdSet,
    selectedAccountChannelId,
    contactSearch,
    audienceWhatsappStatus,
    audienceRegions,
    audienceLastCampaignFrom,
    audienceLastCampaignTo
  ]);
  const channelScopedSelectedContacts = useMemo(() => {
    return selectedContacts.filter((id) => {
      if (audienceMode === "excel" && !excelIdSet.has(id)) return false;
      if (!selectedAccountChannelId) return true;
      const contact = contactById.get(id);
      if (!contact) return true;
      return contact.channel_id === selectedAccountChannelId;
    });
  }, [selectedContacts, selectedAccountChannelId, contactById, audienceMode, excelIdSet]);
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
    if (!selectedAccountChannelId && audienceMode !== "excel") return;
    setSelectedContacts((current) => {
      const pruned = current.filter((id) => {
        if (audienceMode === "excel" && !excelIdSet.has(id)) return false;
        if (!selectedAccountChannelId) return true;
        const contact = contactById.get(id);
        if (!contact) return true;
        return contact.channel_id === selectedAccountChannelId;
      });
      return pruned.length === current.length ? current : pruned;
    });
  }, [selectedAccountChannelId, contactById, audienceMode, excelIdSet]);

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
        exclude_risky: excludeRisky,
        only_never_sent: onlyNeverSent,
        exclude_sent_in_period: excludeSentInPeriod,
        exclude_sent_from: excludeSentFrom ? `${excludeSentFrom}T00:00:00` : null,
        exclude_sent_to: excludeSentTo ? `${excludeSentTo}T00:00:00` : null,
        exclude_campaign_ids: excludeCampaignIds
      })
      .then((res) => setPreflight(res.data as CampaignPreflight))
      .catch(() => setPreflight(null));
  }, [
    templateId,
    channelScopedSelectedContacts,
    accountId,
    includeOptOutOption,
    excludeUnreachable,
    excludeRisky,
    onlyNeverSent,
    excludeSentInPeriod,
    excludeSentFrom,
    excludeSentTo,
    excludeCampaignIds
  ]);

  function onOrganizationChange(value: string) {
    setOrganizationId(value);
    setChannelId("");
    setSelectedContacts([]);
    setExcelAudienceIds([]);
    setAudienceMode("library");
    setAudienceTagIds([]);
    setAudienceRegions([]);
    setPreflight(null);
  }

  function clearExcelAudienceLock() {
    setAudienceMode("library");
    setExcelAudienceIds([]);
    toastStore.getState().show("تم فتح اختيار العملاء من المكتبة.", "success");
  }

  function applyEligibleAudienceOnly() {
    const ids = (preflight?.eligible_contact_ids ?? []).filter((id) =>
      channelScopedSelectedContacts.includes(id)
    );
    if (!ids.length) {
      // Client-side fallback: keep only accepts / unknown from current selection
      const fallback = channelScopedSelectedContacts.filter((id) => {
        const contact = contactById.get(id);
        if (!contact) return false;
        if (contact.marketing_opt_in === false) return false;
        if (contact.whatsapp_status === "invalid" || contact.whatsapp_status === "unreachable") return false;
        return true;
      });
      if (!fallback.length) {
        toastStore.getState().show("لا يوجد عملاء مؤهلون بعد الفحص.", "error");
        return;
      }
      setSelectedContacts(fallback);
      setExcludeUnreachable(true);
      toastStore.getState().show(`تم الإبقاء على ${fallback.length} عميلاً مؤهلاً فقط.`, "success");
      return;
    }
    setSelectedContacts(ids);
    setExcludeUnreachable(true);
    toastStore.getState().show(`تم الإبقاء على ${ids.length} عميلاً مؤهلاً فقط (بعد فحص الأرقام).`, "success");
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
      setExcelAudienceIds(ids);
      setAudienceMode("excel");
      setSelectedContacts(ids);
      setExcludeUnreachable(true);
      setAudienceTagIds([]);
      setAudienceWhatsappStatus("");
      setAudienceRegions([]);
      setAudienceSegmentFilterId("");
      setAudienceLastCampaignFrom("");
      setAudienceLastCampaignTo("");
      setContactSearch("");
      const skipped = result.data.skipped ?? 0;
      const invalid = result.data.invalid ?? 0;
      toastStore.getState().show(
        `تم قفل الجمهور على ملف Excel فقط: ${ids.length} عميل (${result.data.created} جديد، ${result.data.existing} موجود${invalid ? `، ${invalid} رقم غير صالح واستُبعد` : ""}${skipped ? `، ${skipped} فارغ` : ""}).`,
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
      setAudienceMode("library");
      setExcelAudienceIds([]);
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
      setAudienceMode("library");
      setExcelAudienceIds([]);
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
      toastStore.getState().show(
        audienceMode === "excel"
          ? "لا يوجد عملاء من ملف Excel محددين للإرسال."
          : "اختر عملاء للحملة على قناة WhatsApp المحددة.",
        "error"
      );
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
      const recipientIds =
        audienceMode === "excel"
          ? channelScopedSelectedContacts.filter((id) => excelIdSet.has(id))
          : channelScopedSelectedContacts;
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
        only_never_sent: onlyNeverSent,
        exclude_sent_in_period: excludeSentInPeriod,
        exclude_sent_from: excludeSentFrom ? `${excludeSentFrom}T00:00:00` : null,
        exclude_sent_to: excludeSentTo ? `${excludeSentTo}T00:00:00` : null,
        exclude_campaign_ids: excludeCampaignIds,
        recipients: recipientIds.map((contact_id) => ({
          contact_id,
          template_parameters: templateParameters
        }))
      }, requestOptions);
      const campaignId = response.data.id as string;
      await approveAndStartCampaign(campaignId, requestOptions);
      setName("");
      setSelectedContacts([]);
      setExcelAudienceIds([]);
      setAudienceMode("library");
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

          <div className="campaigns-create-stack">
            <form id="campaign-create-form" className="campaigns-panel campaigns-settings-panel stack-form" onSubmit={create}>
              <h3>إعدادات الحملة</h3>
              <div className="campaigns-settings-fields">
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
              </div>
              {accountId && accountTemplates.length === 0 && (
                <p className="hint-text campaign-warning">
                  لا توجد قوالب معتمدة لهذا الحساب. افتح{" "}
                  <Link to="/templates">صفحة القوالب</Link>
                  {" "}→ تبويب «مزامنة من Meta» → اختر نفس الحساب → Sync.
                </p>
              )}
              <p className="hint-text">
                لظهور زر «تسوق الآن» أسفل الرسالة: أنشئ قالباً مع رابط الموقع من{" "}
                <Link to="/templates">القوالب</Link>
                {" "}ثم اختره هنا بعد اعتماده.
              </p>
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
              {!approvedTemplates.length && (
                <p className="hint-text">لا توجد قوالب معتمدة — أضف من صفحة القوالب أو زامِن من Meta.</p>
              )}
            </form>

            <div className="campaigns-panel campaigns-exclude-panel stack-form">
              <div className="admin-table-header campaigns-exclude-card-head">
                <div>
                  <h3 className="section-title-sm">الاستبعادات والفحص قبل الإرسال</h3>
                  <p className="hint-text">حدّد الفترة أولاً، ثم خيارات الاستبعاد وجدول من أُرسل لهم جنباً إلى جنب — فوق جدول العملاء.</p>
                </div>
              </div>
              <div className="campaign-period-filter">
                <strong>فلتر حسب الحملة / التاريخ</strong>
                <p className="hint-text">
                  استبعد من أُرسل لهم ضمن فترة معيّنة، أو اختر حملات سابقة من القائمة.
                </p>
                <div className="campaign-period-dates">
                  <label className="field-label">
                    <span>من تاريخ</span>
                    <input
                      type="date"
                      value={excludeSentFrom}
                      onChange={(event) => setExcludeSentFrom(event.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    <span>إلى تاريخ</span>
                    <input
                      type="date"
                      value={excludeSentTo}
                      onChange={(event) => setExcludeSentTo(event.target.value)}
                    />
                  </label>
                </div>
                <label className="campaign-check-row">
                  <input
                    type="checkbox"
                    checked={excludeSentInPeriod}
                    onChange={(event) => setExcludeSentInPeriod(event.target.checked)}
                    disabled={!excludeSentFrom && !excludeSentTo && excludeCampaignIds.length === 0}
                  />
                  <span>استبعاد من أُرسل لهم في الفترة أو الحملات المحددة</span>
                </label>
              </div>
              <div className="campaign-exclude-columns">
                <div className="campaign-exclude-options" role="group" aria-label="خيارات الاستبعاد">
                  <strong className="campaign-exclude-options-title">خيارات الاستبعاد قبل الإرسال</strong>
                  <label className="campaign-check-row">
                    <input
                      type="checkbox"
                      checked={includeOptOutOption}
                      onChange={(event) => setIncludeOptOutOption(event.target.checked)}
                    />
                    <span>إظهار خيار «عدم الإزعاج» للعملاء واستبعاد من اختاروه تلقائياً</span>
                  </label>
                  <label className="campaign-check-row">
                    <input
                      type="checkbox"
                      checked={excludeUnreachable}
                      onChange={(event) => setExcludeUnreachable(event.target.checked)}
                    />
                    <span>استبعاد العملاء غير القابلين للوصول (فشل سابق أو رقم غير صالح)</span>
                  </label>
                  <label className="campaign-check-row">
                    <input
                      type="checkbox"
                      checked={excludeRisky}
                      onChange={(event) => setExcludeRisky(event.target.checked)}
                    />
                    <span>استبعاد العملاء بدون تفاعل سابق (محفوف بالمخاطر)</span>
                  </label>
                  <label className="campaign-check-row">
                    <input
                      type="checkbox"
                      checked={onlyNeverSent}
                      onChange={(event) => setOnlyNeverSent(event.target.checked)}
                    />
                    <span>عملاء جدد فقط — من لم يُرسل لهم رسالة من قبل (عزل من سبق إرسالهم)</span>
                  </label>
                </div>
                <div className="campaign-period-groups-panel">
                  <strong className="campaign-exclude-options-title">استبعاد من أُرسل لهم (حملات سابقة)</strong>
                  {(() => {
                  const periodGroups = preflight?.campaigns_in_period?.length
                    ? preflight.campaigns_in_period
                    : (campaigns.data ?? [])
                        .filter((item) => !item.archived_at && (item.report.sent + item.report.delivered + item.report.read) > 0)
                        .slice(0, 30)
                        .map((item) => ({
                          id: item.id,
                          name: item.name,
                          started_at: item.started_at,
                          completed_at: item.completed_at,
                          status: item.status,
                          sent_count: item.report.sent + item.report.delivered + item.report.read,
                          first_sent_at: item.started_at,
                          last_sent_at: item.completed_at || item.started_at
                        }));
                  if (!periodGroups.length) {
                    return <p className="hint-text campaign-period-empty">لا توجد حملات سابقة للاختيار منها بعد.</p>;
                  }
                  const allSelected =
                    periodGroups.length > 0 &&
                    periodGroups.every((item) => excludeCampaignIds.includes(item.id));
                  return (
                    <div className="campaign-period-groups">
                      <div className="campaign-period-groups-toolbar">
                        <small className="hint-text">
                          {preflight?.campaigns_in_period?.length
                            ? "حملات في الفترة — اختر للاستبعاد:"
                            : "حملات سابقة حسب التاريخ — اختر للاستبعاد:"}
                        </small>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => {
                              if (allSelected) {
                                setExcludeCampaignIds([]);
                                return;
                              }
                              setExcludeCampaignIds(periodGroups.map((item) => item.id));
                              setExcludeSentInPeriod(true);
                            }}
                          >
                            {allSelected ? "إلغاء تحديد الكل" : "تحديد كل الحملات"}
                          </button>
                        </div>
                      </div>
                      <div className="admin-table-wrap campaign-exclude-table-wrap">
                        <table className="admin-erp-table campaign-exclude-table">
                          <thead>
                            <tr>
                              <th className="contacts-col-check">
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  onChange={(event) => {
                                    if (event.target.checked) {
                                      setExcludeCampaignIds(periodGroups.map((item) => item.id));
                                      setExcludeSentInPeriod(true);
                                    } else {
                                      setExcludeCampaignIds([]);
                                    }
                                  }}
                                  aria-label="تحديد كل الحملات"
                                />
                              </th>
                              <th>اسم الحملة</th>
                              <th>التاريخ</th>
                              <th>المستلمون</th>
                            </tr>
                          </thead>
                          <tbody>
                            {periodGroups.map((item) => {
                              const checked = excludeCampaignIds.includes(item.id);
                              const when = item.last_sent_at || item.started_at;
                              const labelDate = when
                                ? new Date(when).toLocaleDateString("ar-KW", {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric"
                                  })
                                : "—";
                              return (
                                <tr key={item.id} className={checked ? "contacts-row-selected" : undefined}>
                                  <td className="contacts-col-check">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        if (!checked) setExcludeSentInPeriod(true);
                                        setExcludeCampaignIds((current) =>
                                          checked
                                            ? current.filter((id) => id !== item.id)
                                            : [...current, item.id]
                                        );
                                      }}
                                      aria-label={`استبعاد ${item.name}`}
                                    />
                                  </td>
                                  <td>
                                    <strong>{item.name}</strong>
                                  </td>
                                  <td>{labelDate}</td>
                                  <td>{item.sent_count.toLocaleString("ar")}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
                </div>
              </div>
              {preflight && channelScopedSelectedContacts.length > 0 && (
                <div className="campaign-preflight-panel">
                  <strong>فحص الجمهور قبل الإرسال</strong>
                  <div className="campaign-preflight-stats">
                    <div><strong>{preflight.total}</strong><span>إجمالي</span></div>
                    <div><strong>{preflight.eligible_recipients ?? preflight.marketing_opt_in ?? preflight.total}</strong><span>مؤهل للإرسال</span></div>
                    <div><strong>{preflight.reachable ?? 0}</strong><span>قابل للوصول</span></div>
                    <div><strong>{preflight.unreachable ?? 0}</strong><span>غير قابل</span></div>
                    <div><strong>{preflight.invalid_phone ?? 0}</strong><span>رقم غير صالح</span></div>
                    <div><strong>{preflight.risky ?? 0}</strong><span>محفوف بالمخاطر</span></div>
                    <div><strong>{preflight.marketing_opt_out ?? 0}</strong><span>عدم الإزعاج</span></div>
                    <div><strong>{preflight.cold_audience ?? preflight.never_messaged}</strong><span>بدون تفاعل</span></div>
                    <div><strong>{preflight.warm_audience ?? preflight.window_open + preflight.window_closed}</strong><span>تفاعل سابق</span></div>
                    <div><strong>{preflight.never_sent ?? 0}</strong><span>لم يُرسل لهم</span></div>
                    <div><strong>{preflight.previously_sent ?? 0}</strong><span>سبق إرسالهم</span></div>
                    <div><strong>{preflight.sent_in_period ?? 0}</strong><span>أُرسل لهم في الفترة</span></div>
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
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={applyEligibleAudienceOnly}
                  >
                    تطبيق الفحص: أبقِ المؤهلين فقط (استبعاد غير صالح / بلا واتساب / عدم إزعاج)
                  </button>
                </div>
              )}
              {Boolean(preflight?.never_sent_contact_ids?.length) && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const ids = (preflight?.never_sent_contact_ids ?? []).filter((id) =>
                      channelScopedSelectedContacts.includes(id)
                    );
                    if (!ids.length) {
                      toastStore.getState().show("لا يوجد ضمن التحديد عملاء لم يُرسل لهم من قبل.", "error");
                      return;
                    }
                    setSelectedContacts(ids);
                    setOnlyNeverSent(true);
                    toastStore.getState().show(`تم عزل ${ids.length} عميلاً جديداً فقط.`, "success");
                  }}
                >
                  عزل التحديد: اختر فقط من لم يُرسل لهم ({preflight?.never_sent ?? 0})
                </button>
              )}
              {Boolean(preflight?.sent_in_period) && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const kept = (preflight?.kept_after_period_exclude_contact_ids ?? []).filter((id) =>
                      channelScopedSelectedContacts.includes(id)
                    );
                    if (!kept.length) {
                      toastStore.getState().show("بعد الاستبعاد لا يتبقى أحد ضمن التحديد.", "error");
                      return;
                    }
                    setSelectedContacts(kept);
                    setExcludeSentInPeriod(true);
                    toastStore.getState().show(
                      `تم استبعاد ${(preflight?.sent_in_period ?? 0)} عميلاً — تبقّى ${kept.length}.`,
                      "success"
                    );
                  }}
                >
                  عزل التحديد: استبعد من أُرسل لهم في الفترة ({preflight?.sent_in_period ?? 0})
                </button>
              )}
            </div>

            <div className="campaigns-audience-panel">
              <div className="admin-table-header campaigns-audience-card-head">
                <div>
                  <h3 className="section-title-sm">جدول جمهور الحملة</h3>
                  <p className="hint-text">
                    {audienceMode === "excel"
                      ? "الجمهور مقيّد بملف Excel — يمكنك فلترة الجدول وتحديد/إلغاء داخل الملف فقط."
                      : "فلتر ثم حدّد العملاء من الجدول، أو ارفع Excel لقفل الجمهور على الملف فقط."}
                  </p>
                </div>
              </div>
              <form className="campaigns-excel-toolbar" onSubmit={importAudience}>
                <label className="field-label campaigns-excel-file">
                  <span>ملف Excel أو CSV</span>
                  <input
                    name="file"
                    type="file"
                    accept=".xlsx,.xlsm,.csv,text/csv"
                    required
                    disabled={!organizationId || !channelId}
                  />
                </label>
                <div className="campaigns-excel-toolbar-side">
                  <p className="hint-text campaigns-excel-columns">
                    الأعمدة: <strong dir="ltr">phone</strong> (إلزامي) · <strong dir="ltr">name</strong> · <strong dir="ltr">language</strong> · <strong dir="ltr">region</strong>
                  </p>
                  <div className="campaigns-excel-actions">
                    <button
                      type="submit"
                      className="whatsapp-button compact"
                      disabled={!organizationId || !channelId}
                    >
                      رفع Excel وقفل الجمهور
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => void downloadContactsImportTemplate().catch(() => toastStore.getState().show("تعذر تحميل القالب.", "error"))}
                    >
                      تحميل قالب Excel
                    </button>
                  </div>
                </div>
                {audienceMode === "excel" && (
                  <div className="campaign-excel-lock-banner" role="status">
                    <strong>وضع Excel مفعّل</strong>
                    <span>{excelAudienceIds.length.toLocaleString("ar")} رقم من الملف فقط</span>
                    <button type="button" className="secondary-button compact" onClick={clearExcelAudienceLock}>
                      إلغاء القفل والاختيار من المكتبة
                    </button>
                  </div>
                )}
                {channelScopedSelectedContacts.length > 0 && (
                  <p className="hint-text campaigns-excel-selected">
                    ✓ {channelScopedSelectedContacts.length} عميل محدّد للحملة
                  </p>
                )}
                {hiddenSelectedCount > 0 && (
                  <p className="hint-text campaigns-audience-warning" role="alert">
                    ⚠ {hiddenSelectedCount} عميل محدّد من قناة أخرى — تم استبعادهم تلقائياً من الإرسال.
                  </p>
                )}
              </form>
            <div className="campaign-audience-filters">
              {audienceMode === "library" && (
                <>
                  <div className="field-label campaign-tag-multiselect" ref={audienceTagMenuRef}>
                    <span>التصنيف</span>
                    <button
                      type="button"
                      className="campaign-tag-multiselect-trigger"
                      onClick={() => setAudienceTagMenuOpen((open) => !open)}
                    >
                      {selectedAudienceTags.length === 0
                        ? "كل التصنيفات"
                        : selectedAudienceTags.length === 1
                          ? selectedAudienceTags[0].name
                          : `${selectedAudienceTags.length} تصنيفات محددةة`}
                    </button>
                    {audienceTagMenuOpen && (
                      <div className="campaign-tag-multiselect-menu" role="listbox" aria-multiselectable="true">
                        <div className="campaign-tag-multiselect-toolbar">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => setAudienceTagIds([])}
                          >
                            مسح التحديد
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => setAudienceTagIds(organizationTags.map((tag) => tag.id))}
                            disabled={organizationTags.length === 0}
                          >
                            تحديد الكل
                          </button>
                        </div>
                        {organizationTags.length === 0 && (
                          <p className="hint-text">لا توجد تصنيفات لهذا الفرع.</p>
                        )}
                        {organizationTags.map((tag) => {
                          const checked = audienceTagIds.includes(tag.id);
                          return (
                            <label key={tag.id} className="campaign-tag-multiselect-option">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setAudienceTagIds((current) =>
                                    checked
                                      ? current.filter((id) => id !== tag.id)
                                      : [...current, tag.id]
                                  );
                                }}
                              />
                              <span>{tag.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <label className="field-label">
                    <span>الشريحة</span>
                    <select
                      value={audienceSegmentFilterId}
                      onChange={(e) => setAudienceSegmentFilterId(e.target.value)}
                    >
                      <option value="">كل الشرائح</option>
                      {(segments.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="field-label campaign-tag-multiselect" ref={audienceRegionMenuRef}>
                <span>المنطقة</span>
                <button
                  type="button"
                  className="campaign-tag-multiselect-trigger"
                  onClick={() => setAudienceRegionMenuOpen((open) => !open)}
                >
                  {audienceRegions.length === 0
                    ? "كل المناطق"
                    : audienceRegions.length === 1
                      ? audienceRegions[0]
                      : `${audienceRegions.length} مناطق محددةة`}
                </button>
                {audienceRegionMenuOpen && (
                  <div className="campaign-tag-multiselect-menu" role="listbox" aria-multiselectable="true">
                    <div className="campaign-tag-multiselect-toolbar">
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setAudienceRegions([])}
                      >
                        مسح التحديد
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setAudienceRegions(availableRegions)}
                        disabled={availableRegions.length === 0}
                      >
                        تحديد الكل
                      </button>
                    </div>
                    {availableRegions.length === 0 && (
                      <p className="hint-text">لا توجد مناطق مسجّلة بعد على العملاء.</p>
                    )}
                    {availableRegions.map((regionName) => {
                      const checked = audienceRegions.includes(regionName);
                      const count = regionCountByName.get(regionName) ?? 0;
                      return (
                        <label key={regionName} className="campaign-tag-multiselect-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setAudienceRegions((current) =>
                                checked
                                  ? current.filter((item) => item !== regionName)
                                  : [...current, regionName]
                              );
                            }}
                          />
                          <span>
                            {regionName}
                            {count > 0 ? ` (${count.toLocaleString("ar")})` : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <label className="field-label">
                <span>حالة واتساب</span>
                <select
                  value={audienceWhatsappStatus}
                  onChange={(e) => setAudienceWhatsappStatus(e.target.value)}
                >
                  <option value="">كل الحالات</option>
                  {Object.entries(WHATSAPP_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                <span>آخر حملة من</span>
                <input
                  type="date"
                  value={audienceLastCampaignFrom}
                  onChange={(e) => setAudienceLastCampaignFrom(e.target.value)}
                />
              </label>
              <label className="field-label">
                <span>آخر حملة إلى</span>
                <input
                  type="date"
                  value={audienceLastCampaignTo}
                  onChange={(e) => setAudienceLastCampaignTo(e.target.value)}
                />
              </label>
              {audienceMode === "library" && (
                <>
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
                </>
              )}
            </div>
            {audienceMode === "library" && (
              <>
                <div className="field-label">
                  <span>الاهتمامات (اختياري)</span>
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
                <div className="inline-actions">
                  <button type="button" className="contacts-erp-btn contacts-erp-btn-primary" onClick={() => void applyAudienceFilter()}>
                    تطبيق الاهتمام/الجنس/المرحلة وتحميل الجمهور
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!selectedSegmentId}
                    onClick={() => void loadSegmentAudience()}
                  >
                    تحميل شريحة كاملة
                  </button>
                  <select value={selectedSegmentId} onChange={(e) => setSelectedSegmentId(e.target.value)}>
                    <option value="">اختر شريحة للتحميل</option>
                    {(segments.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="campaigns-audience-toolbar">
              <label className="field-label campaigns-contact-search">
                <span>بحث في الجدول</span>
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="اسم أو رقم…"
                />
              </label>
              <div className="inline-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const ids = filteredContacts.map((c) => c.id);
                    setSelectedContacts((current) => {
                      const base =
                        audienceMode === "excel"
                          ? current.filter((id) => excelIdSet.has(id))
                          : selectedAccountChannelId
                            ? current.filter((id) => contactById.get(id)?.channel_id === selectedAccountChannelId)
                            : current;
                      return Array.from(new Set([...base, ...ids]));
                    });
                  }}
                >
                  تحديد الكل الظاهر ({filteredContacts.length})
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const visible = new Set(filteredContacts.map((c) => c.id));
                    setSelectedContacts((current) => current.filter((id) => !visible.has(id)));
                  }}
                >
                  إلغاء تحديد الظاهر
                </button>
                <button type="button" className="secondary-button" onClick={() => setSelectedContacts([])}>
                  إلغاء الكل
                </button>
                {channelScopedSelectedContacts.length > 0 && (
                  <span className="hint-text">
                    {visibleSelectedCount} ظاهر محدد · {channelScopedSelectedContacts.length} للإرسال
                    {audienceMode === "excel" ? " · Excel فقط" : ""}
                  </span>
                )}
              </div>
            </div>

            {(contacts.data?.length ?? 0) >= CAMPAIGN_AUDIENCE_LIMIT && audienceMode === "library" && (
              <p className="hint-text campaigns-audience-warning" role="status">
                يُعرض حتى {CAMPAIGN_AUDIENCE_LIMIT.toLocaleString("ar")} عميل — للجمهور الأكبر استخدم Excel أعلاه.
              </p>
            )}

            <div className="admin-table-wrap campaigns-audience-table-wrap">
              <table className="admin-erp-table campaigns-audience-table">
                <thead>
                  <tr>
                    <th className="contacts-col-check">
                      <input
                        type="checkbox"
                        checked={
                          filteredContacts.length > 0 &&
                          filteredContacts.every((item) => channelScopedSelectedContacts.includes(item.id))
                        }
                        onChange={(e) => {
                          const ids = filteredContacts.map((c) => c.id);
                          if (e.target.checked) {
                            setSelectedContacts((current) => Array.from(new Set([...current, ...ids])));
                          } else {
                            const visible = new Set(ids);
                            setSelectedContacts((current) => current.filter((id) => !visible.has(id)));
                          }
                        }}
                        aria-label="تحديد الكل الظاهر"
                      />
                    </th>
                    <th>الاسم</th>
                    <th>الهاتف</th>
                    <th>المنطقة</th>
                    <th>حالة واتساب</th>
                    <th>آخر حملة</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <p className="hint-text">لا يوجد عملاء مطابقون للفلاتر الحالية.</p>
                      </td>
                    </tr>
                  )}
                  {filteredContacts.map((item) => {
                    const checked = channelScopedSelectedContacts.includes(item.id);
                    return (
                      <tr key={item.id} className={checked ? "contacts-row-selected" : undefined}>
                        <td className="contacts-col-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedContacts((current) => {
                                if (audienceMode === "excel" && !excelIdSet.has(item.id)) return current;
                                const scoped = selectedAccountChannelId
                                  ? current.filter((id) => contactById.get(id)?.channel_id === selectedAccountChannelId)
                                  : current;
                                return e.target.checked
                                  ? [...scoped, item.id]
                                  : scoped.filter((id) => id !== item.id);
                              });
                            }}
                            aria-label={`تحديد ${item.display_name || item.external_address}`}
                          />
                        </td>
                        <td>{item.display_name || "—"}</td>
                        <td dir="ltr">{item.external_address}</td>
                        <td>{item.region || "—"}</td>
                        <td>
                          <span className={`contacts-wa-status contacts-wa-status-${whatsappStatusTone(item.whatsapp_status)}`}>
                            {formatWhatsAppStatus(item)}
                          </span>
                        </td>
                        <td>
                          {item.last_campaign_at ? (
                            <div className="admin-cell-main">
                              <strong>{item.last_campaign_name || "حملة"}</strong>
                              <small>{formatContactDate(item.last_campaign_at)}</small>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

            <div className="campaigns-panel campaigns-send-panel">
              <button
                type="submit"
                form="campaign-create-form"
                className="whatsapp-button"
                disabled={!channelScopedSelectedContacts.length || preflight?.eligible_recipients === 0}
              >
                إنشاء وبدء الحملة ({preflight?.eligible_recipients ?? channelScopedSelectedContacts.length})
              </button>
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
