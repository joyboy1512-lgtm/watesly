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
  LIFECYCLE_LABELS,
  WHATSAPP_STATUS_LABELS,
  whatsappStatusTone,
  type Contact as ContactRow,
  type Tag
} from "../lib/contactHelpers";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import SearchableMultiFilter, { serializeMultiParam } from "../components/SearchableMultiFilter";
import {
  AUDIENCE_GENDER_OPTIONS,
  buildAudienceResolvePayload,
  slugifyInterestLabel,
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
  reachable_contact_ids?: string[];
  risky_contact_ids?: string[];
  unreachable_contact_ids?: string[];
  invalid_phone_contact_ids?: string[];
  marketing_opt_out_contact_ids?: string[];
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
  const [createStep, setCreateStep] = useState<1 | 2 | 3 | 4>(1);
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
  const [excelAudienceIds, setExcelAudienceIds] = useState<string[]>([]);
  const [segmentAudienceIds, setSegmentAudienceIds] = useState<string[]>([]);
  const [importingAudience, setImportingAudience] = useState(false);
  const [loadingSegmentAudience, setLoadingSegmentAudience] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [audienceTagIds, setAudienceTagIds] = useState<string[]>([]);
  const [audienceWhatsappStatuses, setAudienceWhatsappStatuses] = useState<string[]>([]);
  const [audienceRegions, setAudienceRegions] = useState<string[]>([]);
  const [audienceSegmentFilterId, setAudienceSegmentFilterId] = useState("");
  const [audienceLastCampaignIds, setAudienceLastCampaignIds] = useState<string[]>([]);
  const [audienceLastCampaignFrom, setAudienceLastCampaignFrom] = useState("");
  const [audienceLastCampaignTo, setAudienceLastCampaignTo] = useState("");
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [highlightCampaignId, setHighlightCampaignId] = useState<string | null>(null);
  const [campaignMediaOverride, setCampaignMediaOverride] = useState<UploadedFile | null>(null);
  const [uploadingCampaignMedia, setUploadingCampaignMedia] = useState(false);
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testingSend, setTestingSend] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [audienceGenderFilter, setAudienceGenderFilter] = useState<AudienceGenderFilter>("");
  const [audienceInterestIds, setAudienceInterestIds] = useState<string[]>([]);
  const [newInterestLabel, setNewInterestLabel] = useState("");
  const [creatingInterest, setCreatingInterest] = useState(false);
  const [audienceLifecycleStages, setAudienceLifecycleStages] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<CampaignPreflight | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
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
      excelAudienceIds,
      audienceTagIds,
      audienceWhatsappStatuses,
      audienceRegions,
      audienceSegmentFilterId,
      audienceInterestIds,
      audienceLifecycleStages,
      audienceLastCampaignIds
    ],
    queryFn: async () => {
      const base: Record<string, string | number> = { limit: CAMPAIGN_AUDIENCE_LIMIT };
      if (organizationId) base.organization_id = organizationId;
      if (audienceChannelId) base.channel_id = audienceChannelId;
      if (audienceTagIds.length === 1) base.tag_id = audienceTagIds[0];
      if (audienceTagIds.length > 1) base.tag_ids = serializeMultiParam(audienceTagIds);
      if (audienceWhatsappStatuses.length === 1) base.whatsapp_status = audienceWhatsappStatuses[0];
      if (audienceWhatsappStatuses.length > 1) base.whatsapp_statuses = serializeMultiParam(audienceWhatsappStatuses);
      if (audienceRegions.length === 1) base.region = audienceRegions[0];
      if (audienceRegions.length > 1) base.regions = serializeMultiParam(audienceRegions);
      if (audienceInterestIds.length === 1) base.interest_id = audienceInterestIds[0];
      if (audienceInterestIds.length > 1) base.interest_ids = serializeMultiParam(audienceInterestIds);
      if (audienceLifecycleStages.length === 1) base.lifecycle_stage = audienceLifecycleStages[0];
      if (audienceLifecycleStages.length > 1) base.lifecycle_stages = serializeMultiParam(audienceLifecycleStages);
      if (audienceLastCampaignIds.length) base.last_campaign_ids = serializeMultiParam(audienceLastCampaignIds);
      if (audienceSegmentFilterId) base.segment_id = audienceSegmentFilterId;
      const libraryRows = (await api.get<Contact[]>("/contacts", { params: base })).data;
      if (!excelAudienceIds.length) return libraryRows;

      const chunkSize = 80;
      const seen = new Set(libraryRows.map((item) => item.id));
      const merged = [...libraryRows];
      for (let index = 0; index < excelAudienceIds.length; index += chunkSize) {
        const chunk = excelAudienceIds.slice(index, index + chunkSize);
        const batch = (
          await api.get<Contact[]>("/contacts", {
            params: {
              organization_id: organizationId,
              channel_id: audienceChannelId || undefined,
              ids: chunk.join(","),
              limit: chunk.length
            }
          })
        ).data;
        for (const item of batch) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
      }
      return merged;
    },
    enabled: Boolean(organizationId)
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

  const organizationTags = useMemo(
    () =>
      (tags.data ?? []).filter((tag) => !organizationId || tag.organization_id === organizationId),
    [tags.data, organizationId]
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
  const excelImportChannelId = channelId || selectedAccountChannelId;
  const canImportExcel = Boolean(organizationId && excelImportChannelId);

  useEffect(() => {
    if (!organizationId || channelId) return;
    if (orgChannels.length === 1) {
      setChannelId(orgChannels[0].id);
    }
  }, [organizationId, channelId, orgChannels]);

  useEffect(() => {
    if (!accountId || !selectedAccountChannelId) return;
    if (channelId === selectedAccountChannelId) return;
    setChannelId(selectedAccountChannelId);
  }, [accountId, selectedAccountChannelId, channelId]);

  const contactById = useMemo(
    () => new Map((contacts.data ?? []).map((item) => [item.id, item])),
    [contacts.data]
  );
  const excelIdSet = useMemo(() => new Set(excelAudienceIds), [excelAudienceIds]);
  const segmentIdSet = useMemo(() => new Set(segmentAudienceIds), [segmentAudienceIds]);
  const filteredContacts = useMemo(() => {
    const from = audienceLastCampaignFrom ? new Date(`${audienceLastCampaignFrom}T00:00:00`) : null;
    const to = audienceLastCampaignTo ? new Date(`${audienceLastCampaignTo}T23:59:59`) : null;
    const term = contactSearch.trim().toLowerCase();
    return (contacts.data ?? []).filter((item) => {
      if (selectedAccountChannelId && item.channel_id !== selectedAccountChannelId) return false;
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
    selectedAccountChannelId,
    contactSearch,
    audienceRegions,
    audienceLastCampaignFrom,
    audienceLastCampaignTo
  ]);
  const channelScopedSelectedContacts = useMemo(() => {
    return selectedContacts.filter((id) => {
      if (!selectedAccountChannelId) return true;
      const contact = contactById.get(id);
      if (!contact) return true;
      return contact.channel_id === selectedAccountChannelId;
    });
  }, [selectedContacts, selectedAccountChannelId, contactById]);
  const hiddenSelectedCount = selectedContacts.length - channelScopedSelectedContacts.length;
  const visibleSelectedCount = filteredContacts.filter((item) =>
    channelScopedSelectedContacts.includes(item.id)
  ).length;
  const excelSelectedCount = channelScopedSelectedContacts.filter((id) => excelIdSet.has(id)).length;
  const segmentSelectedCount = channelScopedSelectedContacts.filter((id) => segmentIdSet.has(id)).length;
  const manualSelectedCount = channelScopedSelectedContacts.filter(
    (id) => !excelIdSet.has(id) && !segmentIdSet.has(id)
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
      const pruned = current.filter((id) => {
        const contact = contactById.get(id);
        if (!contact) return true;
        return contact.channel_id === selectedAccountChannelId;
      });
      return pruned.length === current.length ? current : pruned;
    });
  }, [selectedAccountChannelId, contactById]);

  async function runAudiencePreflight(options?: { silent?: boolean }) {
    if (!templateId || !channelScopedSelectedContacts.length) {
      setPreflight(null);
      if (!options?.silent) {
        toastStore.getState().show(
          !templateId ? "اختر القالب المعتمد أولاً ثم افحص الجمهور." : "حدّد جمهور الحملة أولاً.",
          "error"
        );
      }
      return null;
    }
    setPreflightBusy(true);
    try {
      const res = await api.post("/campaigns/preflight", {
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
      });
      const data = res.data as CampaignPreflight;
      setPreflight(data);
      if (!options?.silent) {
        toastStore.getState().show(
          `نتيجة الفحص: ${data.eligible_recipients ?? 0} مؤهل للإرسال من ${data.total}.`,
          "success"
        );
      }
      return data;
    } catch {
      setPreflight(null);
      if (!options?.silent) {
        toastStore.getState().show("تعذر فحص الجمهور. حاول مرة أخرى.", "error");
      }
      return null;
    } finally {
      setPreflightBusy(false);
    }
  }

  useEffect(() => {
    if (!templateId || !channelScopedSelectedContacts.length) {
      setPreflight(null);
      return;
    }
    void runAudiencePreflight({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- manual re-check via button; auto on audience/filter changes
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
    setSegmentAudienceIds([]);
    setAudienceTagIds([]);
    setAudienceRegions([]);
    setPreflight(null);
  }

  function mergeContactIds(current: string[], incoming: string[]) {
    return Array.from(new Set([...current, ...incoming]));
  }

  function clearExcelAudienceSource() {
    if (!excelAudienceIds.length) return;
    const remove = new Set(excelAudienceIds);
    setSelectedContacts((current) => current.filter((id) => !remove.has(id)));
    setExcelAudienceIds([]);
    toastStore.getState().show("تم إزالة أرقام Excel من جمهور الحملة.", "success");
  }

  function clearSegmentAudienceSource() {
    if (!segmentAudienceIds.length) return;
    const remove = new Set(segmentAudienceIds);
    setSelectedContacts((current) => current.filter((id) => !remove.has(id)));
    setSegmentAudienceIds([]);
    toastStore.getState().show("تم إزالة الشريحة من جمهور الحملة.", "success");
  }

  function restoreExcelAudience() {
    if (!excelAudienceIds.length) return;
    setSelectedContacts((current) => mergeContactIds(current, excelAudienceIds));
    toastStore.getState().show(`تمت إعادة دمج أرقام Excel (${excelAudienceIds.length}).`, "success");
  }

  function clearAllAudience() {
    setSelectedContacts([]);
    setExcelAudienceIds([]);
    setSegmentAudienceIds([]);
    setPreflight(null);
    toastStore.getState().show("تم مسح جمهور الحملة.", "success");
  }

  function removeContactsFromSelection(ids: string[], label: string) {
    if (!ids.length) {
      toastStore.getState().show(`لا يوجد ${label} ضمن التحديد الحالي.`, "error");
      return;
    }
    const remove = new Set(ids);
    setSelectedContacts((current) => {
      const next = current.filter((id) => !remove.has(id));
      toastStore.getState().show(`تم استبعاد ${ids.length} (${label}) — تبقّى ${next.length}.`, "success");
      return next;
    });
  }

  function applyEligibleAudienceOnly() {
    const ids = (preflight?.eligible_contact_ids ?? []).filter((id) =>
      channelScopedSelectedContacts.includes(id)
    );
    if (!ids.length) {
      // Client-side fallback: keep only accepts / reachable from current selection
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
    const formEl = event.currentTarget;
    const importChannelId = channelId || selectedAccountChannelId;
    if (!organizationId || !importChannelId) {
      toastStore.getState().show("اختر الفرع وحساب WhatsApp (أو القناة) قبل رفع الملف.", "error");
      return;
    }
    const fileInput = formEl.querySelector('input[name="file"]') as HTMLInputElement | null;
    if (!fileInput?.files?.length) {
      toastStore.getState().show("اختر ملف Excel أو CSV أولاً.", "error");
      return;
    }
    const form = new FormData(formEl);
    form.set("organization_id", organizationId);
    form.set("channel_id", importChannelId);
    setImportingAudience(true);
    try {
      // Do not set Content-Type manually — browser must include multipart boundary.
      const result = await api.post<{
        contact_ids?: string[];
        created: number;
        existing: number;
        skipped?: number;
        invalid?: number;
      }>("/campaigns/import-audience", form, {
        timeout: 300000
      });
      const ids: string[] = result.data.contact_ids ?? [];
      setExcelAudienceIds((current) => mergeContactIds(current, ids));
      setSelectedContacts((current) => mergeContactIds(current, ids));
      setExcludeUnreachable(true);
      setContactSearch("");
      setPreflight(null);
      const skipped = result.data.skipped ?? 0;
      const invalid = result.data.invalid ?? 0;
      if (!ids.length) {
        toastStore.getState().show("لم يُعثر على أرقام صالحة في الملف.", "error");
      } else {
        toastStore.getState().show(
          `تم دمج ${ids.length} رقم من Excel مع جمهور الحملة. يمكنك إضافة شريحة أو جهات اتصال ثم الاستثناء.`,
          "success"
        );
      }
      if (invalid || skipped) {
        toastStore.getState().show(
          `الاستيراد: ${result.data.created} جديد، ${result.data.existing} موجود${invalid ? `، ${invalid} رقم غير صالح` : ""}${skipped ? `، ${skipped} فارغ` : ""}.`,
          invalid ? "error" : "success"
        );
      }
      await client.invalidateQueries({ queryKey: ["contacts"] });
      formEl.reset();
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر استيراد ملف العملاء. استخدم Excel (.xlsx) أو CSV."), "error");
    } finally {
      setImportingAudience(false);
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

  async function loadSegmentAudience(mode: "merge" | "replace" = "merge") {
    if (!selectedSegmentId) return;
    setLoadingSegmentAudience(true);
    try {
      const params: Record<string, string> = {};
      if (selectedAccountChannelId) params.channel_id = selectedAccountChannelId;
      const result = await api.get<{ id: string }[]>(
        `/platform/segments/${selectedSegmentId}/contacts`,
        { params }
      );
      const ids = result.data.map((item) => item.id);
      if (mode === "replace") {
        setSelectedContacts(ids);
        setExcelAudienceIds([]);
        setSegmentAudienceIds(ids);
        toastStore.getState().show(`تم استبدال الجمهور بالشريحة (${ids.length}).`, "success");
      } else {
        setSegmentAudienceIds((current) => mergeContactIds(current, ids));
        setSelectedContacts((current) => mergeContactIds(current, ids));
        toastStore.getState().show(`تم دمج ${ids.length} عميل من الشريحة مع الجمهور.`, "success");
      }
      setPreflight(null);
    } catch {
      toastStore.getState().show("تعذر تحميل الشريحة.", "error");
    } finally {
      setLoadingSegmentAudience(false);
    }
  }

  async function createAudienceInterest() {
    const label = newInterestLabel.trim();
    if (!label) return;
    setCreatingInterest(true);
    try {
      const created = await api.post<InterestCategory>("/platform/interests", {
        label,
        slug: slugifyInterestLabel(label)
      });
      setNewInterestLabel("");
      setAudienceInterestIds((current) =>
        current.includes(created.data.id) ? current : [...current, created.data.id]
      );
      await client.invalidateQueries({ queryKey: ["interests"] });
      toastStore.getState().show("تم إنشاء الاهتمام.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء الاهتمام.", "error");
    } finally {
      setCreatingInterest(false);
    }
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
      audienceGenderFilter || audienceInterestIds.length > 0 || audienceLifecycleStages.length > 0
    );
    if (!hasAudienceFilter) {
      toastStore.getState().show(
        "اختر اهتماماً أو جنساً أو مرحلة العميل — لا يُحمَّل كل العملاء تلقائياً.",
        "error"
      );
      return;
    }
    try {
      const stages = audienceLifecycleStages.length > 0 ? audienceLifecycleStages : [undefined];
      const mergedIds = new Set<string>();
      for (const stage of stages) {
        const payload = buildAudienceResolvePayload({
          organizationId,
          channelId: audienceChannelId,
          genderFilter: audienceGenderFilter,
          interestIds: audienceInterestIds,
          lifecycleStage: stage,
          marketingOptInOnly: true
        });
        const result = await api.post<{
          count: number;
          contact_ids: string[];
          warnings: string[];
        }>("/platform/audience/resolve", payload);
        for (const id of result.data.contact_ids ?? []) mergedIds.add(id);
      }
      const ids = Array.from(mergedIds);
      setSelectedContacts((current) => mergeContactIds(current, ids));
      toastStore.getState().show(`تم دمج ${ids.length} عميل مطابق للفلتر مع الجمهور.`, "success");
      setPreflight(null);
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
      toastStore.getState().show("اختر جمهور الحملة (Excel أو شريحة أو جهات اتصال).", "error");
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
      const recipientIds = channelScopedSelectedContacts;
      const scheduledAtIso = scheduledAtLocal
        ? new Date(scheduledAtLocal).toISOString()
        : null;
      if (scheduledAtIso && Number.isNaN(Date.parse(scheduledAtIso))) {
        toastStore.getState().show("وقت الجدولة غير صالح.", "error");
        return;
      }
      if (scheduledAtIso && Date.parse(scheduledAtIso) <= Date.now()) {
        toastStore.getState().show("اختر وقتاً في المستقبل للجدولة، أو اترك الحقل فارغاً للإرسال الفوري.", "error");
        return;
      }
      const response = await api.post("/campaigns", {
        organization_id: organizationId,
        whatsapp_account_id: accountId,
        template_id: templateId,
        name,
        scheduled_at: scheduledAtIso,
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
      setSegmentAudienceIds([]);
      setCampaignMediaOverride(null);
      setScheduledAtLocal("");
      setExpandedCampaignId(campaignId);
      setHighlightCampaignId(campaignId);
      setActiveTab("list");
      if (scheduledAtIso) {
        toastStore.getState().show("تم جدولة الحملة — ستُرسل تلقائياً في الوقت المحدد.", "success");
      } else {
        await waitForCampaignReport(client, campaignId);
        toastStore.getState().show("تم بدء الحملة — تظهر النتيجة في الجدول.", "success");
      }
    } catch (error) {
      toastStore.getState().show(
        formatApiError(error, "تعذر إنشاء الحملة. تحقق من القالب المعتمد، أو أن الجمهور لم يرفض التسويق."),
        "error"
      );
    }
  }

  async function sendCampaignTest() {
    if (!accountId || !templateId) {
      toastStore.getState().show("اختر حساب WhatsApp والقالب المعتمد أولاً.", "error");
      return;
    }
    const phone = testPhone.trim();
    if (phone.length < 8) {
      toastStore.getState().show("أدخل رقم اختبار صالحاً مع رمز الدولة.", "error");
      return;
    }
    setTestingSend(true);
    try {
      const templateParameters = buildSendComponents(selectedTemplate?.components, campaignMediaOverride
        ? { mediaUrl: campaignMediaOverride.public_url, filename: campaignMediaOverride.filename }
        : undefined);
      await api.post("/campaigns/test-send", {
        whatsapp_account_id: accountId,
        template_id: templateId,
        to: phone,
        components: templateParameters
      });
      toastStore.getState().show("تم إرسال رسالة اختبار للرقم المحدد.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر إرسال رسالة الاختبار."), "error");
    } finally {
      setTestingSend(false);
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
              <small>معالج من 4 خطوات: جمهور → رسالة → مراجعة → إرسال</small>
            </div>
          </div>

          <div className="campaign-wizard-steps" role="tablist" aria-label="خطوات إنشاء الحملة">
            {([
              [1, "الجمهور"],
              [2, "الرسالة"],
              [3, "المراجعة"],
              [4, "الإرسال"]
            ] as const).map(([step, label]) => (
              <button
                key={step}
                type="button"
                className={createStep === step ? "campaign-wizard-step active" : "campaign-wizard-step"}
                onClick={() => setCreateStep(step)}
              >
                <span>{step}</span>
                {label}
              </button>
            ))}
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
              {!channelId && selectedAccountChannelId ? (
                <small className="hint-text">تُستخدم قناة حساب WhatsApp تلقائياً إن تُركت فارغة.</small>
              ) : null}
            </label>
          </div>

          <div className={`campaigns-create-stack campaign-wizard-active-step-${createStep}`}>
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
                    const nextAccountId = e.target.value;
                    setAccountId(nextAccountId);
                    const account = (accounts.data ?? []).find((item) => item.id === nextAccountId);
                    if (account?.channel_id) setChannelId(account.channel_id);
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
              <div className="campaign-preflight-actions">
                <button
                  type="button"
                  className="whatsapp-button"
                  disabled={preflightBusy || !templateId || !channelScopedSelectedContacts.length}
                  onClick={() => void runAudiencePreflight()}
                >
                  {preflightBusy ? "جاري فحص الجمهور…" : "فحص الجمهور"}
                </button>
                <p className="hint-text">
                  يمكنك الضغط مراراً بعد تعديل خيارات الاستبعاد لتعظيم عدد المؤهلين للإرسال.
                </p>
              </div>
              {preflight && channelScopedSelectedContacts.length > 0 && (
                <div className="campaign-preflight-panel">
                  <strong>نتيجة فحص الجمهور</strong>
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
                  <div className="campaign-preflight-trim" role="group" aria-label="تحكم بجمهور الحملة بعد الفحص">
                    <strong className="campaign-exclude-options-title">تحكم بجمهور الحملة بعد الفحص</strong>
                    <div className="campaign-preflight-trim-actions">
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={applyEligibleAudienceOnly}
                      >
                        أبقِ المؤهلين فقط ({preflight.eligible_recipients ?? 0})
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!(preflight.invalid_phone_contact_ids?.length)}
                        onClick={() =>
                          removeContactsFromSelection(
                            (preflight.invalid_phone_contact_ids ?? []).filter((id) =>
                              channelScopedSelectedContacts.includes(id)
                            ),
                            "رقم غير صالح"
                          )
                        }
                      >
                        استبعد رقم غير صالح ({preflight.invalid_phone ?? 0})
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!(preflight.unreachable_contact_ids?.length)}
                        onClick={() =>
                          removeContactsFromSelection(
                            (preflight.unreachable_contact_ids ?? []).filter((id) =>
                              channelScopedSelectedContacts.includes(id)
                            ),
                            "غير قابل للوصول"
                          )
                        }
                      >
                        استبعد غير قابل للوصول ({preflight.unreachable ?? 0})
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!(preflight.risky_contact_ids?.length)}
                        onClick={() =>
                          removeContactsFromSelection(
                            (preflight.risky_contact_ids ?? []).filter((id) =>
                              channelScopedSelectedContacts.includes(id)
                            ),
                            "محفوف بالمخاطر"
                          )
                        }
                      >
                        استبعد محفوف بالمخاطر ({preflight.risky ?? 0})
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        disabled={!(preflight.marketing_opt_out_contact_ids?.length)}
                        onClick={() =>
                          removeContactsFromSelection(
                            (preflight.marketing_opt_out_contact_ids ?? []).filter((id) =>
                              channelScopedSelectedContacts.includes(id)
                            ),
                            "عدم الإزعاج"
                          )
                        }
                      >
                        استبعد عدم الإزعاج ({preflight.marketing_opt_out ?? 0})
                      </button>
                      {excelAudienceIds.length > 0 && (
                        <button type="button" className="secondary-button compact" onClick={restoreExcelAudience}>
                          أعد دمج أرقام Excel
                        </button>
                      )}
                    </div>
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
                  <h3 className="section-title-sm">جمهور الحملة</h3>
                  <p className="hint-text">
                    اجمع بين Excel والشريحة وجهات الاتصال، ثم استخدم الاستثناءات والتقليم بعد الفحص.
                  </p>
                </div>
              </div>

              <div className="campaign-audience-sources" aria-label="مصادر الجمهور">
                <form className="campaign-audience-source-card" onSubmit={importAudience}>
                  <strong>1) ملف Excel</strong>
                  <p className="hint-text">ارفع قائمة لدمجها مع الجمهور الحالي.</p>
                  <label className="field-label campaigns-excel-file">
                    <span>ملف Excel أو CSV</span>
                    <input
                      name="file"
                      type="file"
                      accept=".xlsx,.xlsm,.csv,text/csv"
                      required
                      disabled={!canImportExcel || importingAudience}
                    />
                  </label>
                  <p className="hint-text campaigns-excel-columns">
                    الأعمدة: <strong dir="ltr">phone</strong> · <strong dir="ltr">name</strong> · <strong dir="ltr">region</strong>
                  </p>
                  {!canImportExcel ? (
                    <p className="hint-text campaigns-audience-warning" role="alert">
                      اختر الفرع وحساب WhatsApp أولاً.
                    </p>
                  ) : null}
                  <div className="campaigns-excel-actions">
                    <button
                      type="submit"
                      className="whatsapp-button compact"
                      disabled={!canImportExcel || importingAudience}
                    >
                      {importingAudience ? "جارٍ الرفع..." : "دمج من Excel"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => void downloadContactsImportTemplate().catch(() => toastStore.getState().show("تعذر تحميل القالب.", "error"))}
                    >
                      قالب Excel
                    </button>
                  </div>
                </form>

                <div className="campaign-audience-source-card">
                  <strong>2) قائمة محفوظة</strong>
                  <p className="hint-text">اختر شريحة جاهزة وادمجها أو استبدل بها الجمهور.</p>
                  <label className="field-label">
                    <span>الشريحة</span>
                    <select value={selectedSegmentId} onChange={(e) => setSelectedSegmentId(e.target.value)}>
                      <option value="">اختر شريحة</option>
                      {(segments.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="campaigns-excel-actions">
                    <button
                      type="button"
                      className="whatsapp-button compact"
                      disabled={!selectedSegmentId || loadingSegmentAudience}
                      onClick={() => void loadSegmentAudience("merge")}
                    >
                      {loadingSegmentAudience ? "جارٍ التحميل..." : "دمج الشريحة"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      disabled={!selectedSegmentId || loadingSegmentAudience}
                      onClick={() => void loadSegmentAudience("replace")}
                    >
                      استبدال بالجمهور
                    </button>
                  </div>
                </div>

                <div className="campaign-audience-source-card">
                  <strong>3) جهات الاتصال</strong>
                  <p className="hint-text">فلتر الجدول أدناه وحدّد يدوياً — يُضاف للتحديد الحالي.</p>
                  <p className="hint-text campaigns-excel-selected">
                    الظاهر الآن: {filteredContacts.length.toLocaleString("ar")} · المحدّد للإرسال:{" "}
                    {channelScopedSelectedContacts.length.toLocaleString("ar")}
                  </p>
                  <div className="campaigns-excel-actions">
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => {
                        const ids = filteredContacts.map((c) => c.id);
                        setSelectedContacts((current) => mergeContactIds(current, ids));
                      }}
                    >
                      دمج الظاهر في التحديد
                    </button>
                    <button type="button" className="secondary-button compact" onClick={clearAllAudience}>
                      مسح كل الجمهور
                    </button>
                  </div>
                </div>
              </div>

              {(excelAudienceIds.length > 0 || segmentAudienceIds.length > 0 || channelScopedSelectedContacts.length > 0) && (
                <div className="campaign-audience-merge-banner" role="status">
                  <strong>الجمهور المدمج</strong>
                  <span>
                    Excel {excelSelectedCount.toLocaleString("ar")} · شريحة {segmentSelectedCount.toLocaleString("ar")} · يدوي{" "}
                    {manualSelectedCount.toLocaleString("ar")} · الإجمالي{" "}
                    {channelScopedSelectedContacts.length.toLocaleString("ar")}
                  </span>
                  <div className="campaigns-excel-actions">
                    {excelAudienceIds.length > 0 && (
                      <>
                        <button type="button" className="secondary-button compact" onClick={restoreExcelAudience}>
                          إعادة دمج Excel
                        </button>
                        <button type="button" className="secondary-button compact" onClick={clearExcelAudienceSource}>
                          إزالة Excel
                        </button>
                      </>
                    )}
                    {segmentAudienceIds.length > 0 && (
                      <button type="button" className="secondary-button compact" onClick={clearSegmentAudienceSource}>
                        إزالة الشريحة
                      </button>
                    )}
                  </div>
                </div>
              )}
              {hiddenSelectedCount > 0 && (
                <p className="hint-text campaigns-audience-warning" role="alert">
                  ⚠ {hiddenSelectedCount} عميل محدّد من قناة أخرى — تم استبعادهم تلقائياً من الإرسال.
                </p>
              )}

            <div className="campaign-audience-filters campaign-audience-filters-extra">
              <SearchableMultiFilter
                compact
                label="التصنيف"
                allLabel="كل التصنيفات"
                values={audienceTagIds}
                options={organizationTags.map((tag) => ({ value: tag.id, label: tag.name }))}
                onChange={setAudienceTagIds}
              />
              <label className="field-label">
                <span>تصفية بالشريحة</span>
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
              <label className="field-label">
                <span>الجنس</span>
                <select value={audienceGenderFilter} onChange={(e) => setAudienceGenderFilter(e.target.value as AudienceGenderFilter)}>
                  {AUDIENCE_GENDER_OPTIONS.map((item) => (
                    <option key={item.value || "all"} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <SearchableMultiFilter
                compact
                label="مرحلة العميل"
                allLabel="كل المراحل"
                values={audienceLifecycleStages}
                options={Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label }))}
                onChange={setAudienceLifecycleStages}
              />
            </div>
            <div className="contacts-inline-tag-create">
              <input
                value={newInterestLabel}
                onChange={(e) => setNewInterestLabel(e.target.value)}
                placeholder="اهتمام جديد…"
              />
              <button
                type="button"
                className="contacts-erp-btn"
                disabled={creatingInterest || !newInterestLabel.trim()}
                onClick={() => void createAudienceInterest()}
              >
                {creatingInterest ? "…" : "+ اهتمام"}
              </button>
            </div>
            <div className="inline-actions">
              <button type="button" className="contacts-erp-btn contacts-erp-btn-primary" onClick={() => void applyAudienceFilter()}>
                دمج الاهتمام/الجنس/المرحلة في الجمهور
              </button>
            </div>

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
                      const base = selectedAccountChannelId
                        ? current.filter((id) => contactById.get(id)?.channel_id === selectedAccountChannelId)
                        : current;
                      return mergeContactIds(base, ids);
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
                <button type="button" className="secondary-button" onClick={clearAllAudience}>
                  إلغاء الكل
                </button>
                {channelScopedSelectedContacts.length > 0 && (
                  <span className="hint-text">
                    {visibleSelectedCount} ظاهر محدد · {channelScopedSelectedContacts.length} للإرسال
                  </span>
                )}
              </div>
            </div>

            {(contacts.data?.length ?? 0) >= CAMPAIGN_AUDIENCE_LIMIT && (
              <p className="hint-text campaigns-audience-warning" role="status">
                يُعرض حتى {CAMPAIGN_AUDIENCE_LIMIT.toLocaleString("ar")} عميل في الجدول — للجمهور الأكبر ادمج Excel أو شريحة أعلاه.
              </p>
            )}

            <div className="admin-table-wrap campaigns-audience-table-wrap">
              <table className="admin-erp-table campaigns-audience-table contacts-erp-table-filter-headers">
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
                    <th className="contacts-th-filter">
                      <SearchableMultiFilter
                        variant="header"
                        label="المنطقة"
                        allLabel="كل المناطق"
                        values={audienceRegions}
                        options={availableRegions.map((regionName) => {
                          const count = regionCountByName.get(regionName) ?? 0;
                          return {
                            value: regionName,
                            label: count > 0 ? `${regionName} (${count.toLocaleString("ar")})` : regionName
                          };
                        })}
                        onChange={setAudienceRegions}
                      />
                    </th>
                    <th className="contacts-th-filter">
                      <SearchableMultiFilter
                        variant="header"
                        label="الاهتمامات"
                        allLabel="كل الاهتمامات"
                        values={audienceInterestIds}
                        options={(interests.data ?? []).map((interest) => ({ value: interest.id, label: interest.label }))}
                        onChange={setAudienceInterestIds}
                      />
                    </th>
                    <th className="contacts-th-filter">
                      <SearchableMultiFilter
                        variant="header"
                        label="حالة واتساب"
                        allLabel="كل الحالات"
                        values={audienceWhatsappStatuses}
                        options={Object.entries(WHATSAPP_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                        onChange={setAudienceWhatsappStatuses}
                      />
                    </th>
                    <th className="contacts-th-filter">
                      <SearchableMultiFilter
                        variant="header"
                        label="آخر حملة"
                        allLabel="كل الحملات"
                        values={audienceLastCampaignIds}
                        options={(campaigns.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
                        onChange={setAudienceLastCampaignIds}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 && (
                    <tr>
                      <td colSpan={7}>
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
                                const scoped = selectedAccountChannelId
                                  ? current.filter((id) => contactById.get(id)?.channel_id === selectedAccountChannelId)
                                  : current;
                                return e.target.checked
                                  ? mergeContactIds(scoped, [item.id])
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
                          {(item.interest_labels ?? []).length > 0 ? (
                            <div className="contacts-tags-cell">
                              {(item.interest_labels ?? []).map((label) => (
                                <span key={`${item.id}-${label}`} className="contacts-tag-chip contacts-interest-chip contacts-tag-chip-active">
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
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
              <div className="campaign-wizard-nav">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={createStep <= 1}
                  onClick={() => setCreateStep((step) => (step > 1 ? ((step - 1) as 1 | 2 | 3 | 4) : step))}
                >
                  السابق
                </button>
                {createStep < 4 ? (
                  <button
                    type="button"
                    className="whatsapp-button"
                    onClick={() => setCreateStep((step) => (step < 4 ? ((step + 1) as 1 | 2 | 3 | 4) : step))}
                  >
                    التالي
                  </button>
                ) : null}
              </div>
              <div className="campaigns-schedule-test">
                <label className="field-label">
                  <span>جدولة الإرسال (اختياري)</span>
                  <input
                    type="datetime-local"
                    value={scheduledAtLocal}
                    onChange={(e) => setScheduledAtLocal(e.target.value)}
                  />
                  <small className="hint-text">اتركه فارغاً للإرسال الفوري بعد الإنشاء.</small>
                </label>
                <div className="campaigns-test-send">
                  <label className="field-label">
                    <span>اختبار القالب قبل البث</span>
                    <input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="+965XXXXXXXX"
                      dir="ltr"
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!accountId || !templateId || testingSend}
                    onClick={() => void sendCampaignTest()}
                  >
                    {testingSend ? "جارٍ الإرسال..." : "إرسال اختبار"}
                  </button>
                </div>
              </div>
              {createStep === 4 && (
              <button
                type="submit"
                form="campaign-create-form"
                className="whatsapp-button"
                disabled={!channelScopedSelectedContacts.length || preflight?.eligible_recipients === 0}
              >
                {scheduledAtLocal
                  ? `جدولة الحملة (${preflight?.eligible_recipients ?? channelScopedSelectedContacts.length})`
                  : `إنشاء وبدء الحملة (${preflight?.eligible_recipients ?? channelScopedSelectedContacts.length})`}
              </button>
              )}
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
