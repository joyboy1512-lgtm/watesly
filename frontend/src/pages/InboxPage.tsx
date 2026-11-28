import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, silentRequest } from "../lib/api";
import { authStore } from "../stores/auth";
import { toastStore } from "../stores/toast";
import { useHasPermission } from "../hooks/usePermissions";
import { uploadFile } from "../lib/uploads";
import { formatWindowExpiry } from "../lib/serviceWindow";
import {
  formatSnoozedUntil,
  formatWaitingExactTime,
  formatWaitingMinutes,
  INBOX_CONVERSATIONS_LIMIT,
  INBOX_CONVERSATIONS_PAGE_SIZE,
  isCurrentlySnoozed,
  normalizeWhatsAppPhone,
  phonesMatch,
  pickOldestWaitingConversation,
  snoozeUntilTomorrowMorning,
  sortWaitingOldestFirst,
  startConversationOnChannel
} from "../lib/inboxHelpers";
import { formatAppTime } from "../lib/language";
import { insertReplyVariable, REPLY_VARIABLES, type ConversationContext } from "../lib/replyVariables";
import {
  QUICK_REPLY_CATEGORIES,
  categoryLabel,
  matchShortcutAutocomplete,
  type QuickReply
} from "../lib/quickReplyHelpers";
import { createDealFromConversation, type DealStage } from "../lib/crmHelpers";
import type { MatchedCatalogProduct } from "../lib/catalogHelpers";
import { buildCartSummary } from "../components/InboxProductPicker";
import {
  llmStatusLabel,
  MODE_LABELS,
  sendArticleFeedback,
  SOURCE_LABELS,
  type AgentSettings,
  type CopilotResult,
  type SmartReplyResult
} from "../lib/knowledgeHelpers";
import CatalogProductCard from "../components/CatalogProductCard";
import InboxProductPicker from "../components/InboxProductPicker";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import type { TemplateComponent } from "../lib/templateMedia";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import InboxMessageBubble, { type WhisperBubble } from "../components/InboxMessageBubble";
import InboxCloseDialog from "../components/InboxCloseDialog";
import InboxEmojiPicker from "../components/InboxEmojiPicker";
import InboxShortcutsMenu from "../components/InboxShortcutsMenu";
import InboxListMessagePanel from "../components/InboxListMessagePanel";
import InboxFlowSend from "../components/InboxFlowSend";
import InboxReplyButtonsPanel from "../components/InboxReplyButtonsPanel";
import InboxTimeline from "../components/InboxTimeline";
import InboxCustomFieldsPanel from "../components/InboxCustomFieldsPanel";
import InboxMergeSuggestions from "../components/InboxMergeSuggestions";
import type { Conversation, Message } from "../types/api";
import type { Tag, Note } from "../types/inbox";
import Icon from "../components/Icon";
import { useSetWorkspaceOrganization, useWorkspaceOrganizationId } from "../hooks/useWorkspace";

type InboxFilter = "engaged" | "all" | "unread" | "waiting" | "mine" | "starred" | "archived" | "snoozed";
type InboxScope = "all" | "mine" | "team" | "unassigned" | "collaborations" | "blocked" | "custom";
type TemplateOption = { id: string; name: string; status: string; body_text: string | null; components: TemplateComponent[] | null; whatsapp_account_id: string };
type ChannelOption = { id: string; name: string; phone: string | null; type: string; messagingReady: boolean };
type WhatsAppAccountRow = { id: string; channel_id: string; channel_name?: string | null; display_phone_number?: string | null };
type ChannelThread = { conversation_id: string; channel_id: string; channel_name: string; display_phone_number: string | null; status: string };
type CustomInboxRow = {
  id: string;
  name: string;
  description: string | null;
  filters: {
    tag_ids?: string[];
    assigned_membership_id?: string | null;
    priority?: string | null;
    status?: string | null;
    starred?: boolean | null;
    needs_reply?: boolean | null;
    channel_type?: string | null;
  };
};
const priorityLabels: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "مرتفعة", urgent: "عاجلة" };
const CHANNEL_TYPE_SHORT: Record<string, string> = {
  whatsapp: "WA",
  instagram: "IG",
  email: "Email",
  sms: "SMS",
  web_chat: "Web",
  telegram: "TG",
  messenger: "MSG"
};

export default function InboxPage() {
  const { t } = useTranslation();
  const canViewUsers = useHasPermission("users.view");
  const canCoach = useHasPermission("conversations.coach");
  const statusLabels: Record<string, string> = useMemo(() => ({
    open: t("inbox.statusOpen"),
    pending: t("inbox.statusPending"),
    closed: t("inbox.statusClosed"),
    spam: t("inbox.statusSpam")
  }), [t]);
  const aiSourceLabels: Record<string, string> = useMemo(() => ({
    knowledge_base: t("inbox.sourceKnowledge"),
    catalog: t("inbox.sourceCatalog"),
    catalog_clarify: "توضيح أنواع المنتج",
    combined: t("inbox.sourceCombined"),
    local: t("inbox.sourceLocal"),
    "knowledge_base+llm": "KB + LLM",
    "catalog+llm": "Catalog + LLM",
    "combined+llm": `${t("inbox.sourceCombined")} + LLM`
  }), [t]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const channelFilter = searchParams.get("channel_id") ?? "";
  const urlFilter = searchParams.get("filter");
  const urlInboxScope = searchParams.get("inbox_scope");
  const urlNeedsReply = searchParams.get("needs_reply");
  const urlSlaBreached = searchParams.get("sla_breached");
  const urlOrganizationId = searchParams.get("organization_id");
  const slaBreachedOnly = urlSlaBreached === "1" || urlSlaBreached === "true";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [noteText, setNoteText] = useState("");
  const [filter, setFilter] = useState<InboxFilter>(() => {
    const allowed: InboxFilter[] = ["engaged", "all", "unread", "waiting", "mine", "starred", "archived", "snoozed"];
    return allowed.includes(urlFilter as InboxFilter) ? (urlFilter as InboxFilter) : "engaged";
  });
  const [listLimit, setListLimit] = useState(INBOX_CONVERSATIONS_PAGE_SIZE);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSuggestionSource, setAiSuggestionSource] = useState<string | null>(null);
  const [matchedProducts, setMatchedProducts] = useState<MatchedCatalogProduct[]>([]);
  const [matchedArticles, setMatchedArticles] = useState<Array<{ id: string; title: string; category: string; body?: string }>>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotResult, setCopilotResult] = useState<CopilotResult | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [replyButtonsOpen, setReplyButtonsOpen] = useState(false);
  const [replyButtonBody, setReplyButtonBody] = useState("");
  const [replyButtonTitles, setReplyButtonTitles] = useState("نعم\nلا");
  const [sendingReplyButtons, setSendingReplyButtons] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [csatScore, setCsatScore] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [suggestedReplies, setSuggestedReplies] = useState<QuickReply[]>([]);
  const [slashHint, setSlashHint] = useState<QuickReply | null>(null);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [newConversationChannelId, setNewConversationChannelId] = useState("");
  const [newConversationPhone, setNewConversationPhone] = useState("");
  const [newConversationName, setNewConversationName] = useState("");
  const [startingConversation, setStartingConversation] = useState(false);
  const [switchingChannelId, setSwitchingChannelId] = useState<string | null>(null);
  const [inboxScope, setInboxScope] = useState<InboxScope>(() => {
    if (
      urlInboxScope === "mine" ||
      urlInboxScope === "team" ||
      urlInboxScope === "unassigned" ||
      urlInboxScope === "collaborations" ||
      urlInboxScope === "blocked" ||
      urlInboxScope === "custom"
    ) {
      return urlInboxScope;
    }
    return "all";
  });
  const [customInboxId, setCustomInboxId] = useState("");
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [closingBusy, setClosingBusy] = useState(false);
  const [closingSummarizing, setClosingSummarizing] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [replyCategoryFilter, setReplyCategoryFilter] = useState<string>("all");
  const [cartProducts, setCartProducts] = useState<MatchedCatalogProduct[]>([]);
  const [listMessageOpen, setListMessageOpen] = useState(false);
  const [flowSendOpen, setFlowSendOpen] = useState(false);
  const [headerAssignOpen, setHeaderAssignOpen] = useState(false);
  const [sendAndClose, setSendAndClose] = useState(false);
  const [newCustomInboxName, setNewCustomInboxName] = useState("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [composerMoreOpen, setComposerMoreOpen] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [translateMode, setTranslateMode] = useState(false);
  const [translateTargetLang, setTranslateTargetLang] = useState<"en" | "fr" | "ur" | "hi">("en");
  const [translatedDraft, setTranslatedDraft] = useState("");
  const [translatingDraft, setTranslatingDraft] = useState(false);
  const [rewritePromptKey, setRewritePromptKey] = useState("");
  const [rewritingDraft, setRewritingDraft] = useState(false);
  const [inboundTranslations, setInboundTranslations] = useState<Record<string, string>>({});
  const [inboundTranslatingId, setInboundTranslatingId] = useState<string | null>(null);
  const workspaceOrganizationId = useWorkspaceOrganizationId();
  const setWorkspaceOrganizationId = useSetWorkspaceOrganization();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSearchRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const savedListScrollRef = useRef(0);
  const draftsByConversationRef = useRef<Record<string, string>>({});
  const textRef = useRef(text);
  textRef.current = text;

  const showArchived = filter === "archived";
  const showSnoozed = filter === "snoozed";
  /** Default: only conversations with customer inbound activity; «الكل» turns this off. */
  const engagedOnly = filter !== "all" && filter !== "waiting";
  const needsReplyOnly =
    filter === "waiting" || urlNeedsReply === "1" || urlNeedsReply === "true";
  const conversationsQuery = useQuery({
    queryKey: [
      "conversations",
      showArchived,
      showSnoozed,
      engagedOnly,
      needsReplyOnly,
      listLimit,
      channelFilter,
      workspaceOrganizationId,
      inboxScope,
      customInboxId
    ],
    queryFn: async ({ signal }) => {
      const params: Record<string, string | boolean | number> = {
        archived: showArchived,
        snoozed: showSnoozed,
        engaged_only: engagedOnly,
        limit: listLimit
      };
      if (needsReplyOnly) params.needs_reply = true;
      if (channelFilter) params.channel_id = channelFilter;
      if (workspaceOrganizationId) params.organization_id = workspaceOrganizationId;
      if (
        inboxScope === "mine" ||
        inboxScope === "team" ||
        inboxScope === "unassigned" ||
        inboxScope === "collaborations" ||
        inboxScope === "blocked"
      ) {
        params.inbox_scope = inboxScope;
      }
      if (inboxScope === "custom" && customInboxId) params.custom_inbox_id = customInboxId;
      return (
        await api.get<Conversation[]>("/conversations", {
          params,
          signal,
          ...silentRequest
        })
      ).data;
    },
    placeholderData: keepPreviousData,
    refetchInterval: 45_000
  });

  useEffect(() => {
    const allowed: InboxFilter[] = ["engaged", "all", "unread", "waiting", "mine", "starred", "archived", "snoozed"];
    if (urlFilter && allowed.includes(urlFilter as InboxFilter) && urlFilter !== filter) {
      setFilter(urlFilter as InboxFilter);
    }
  }, [urlFilter, filter]);

  useEffect(() => {
    if (
      urlInboxScope === "mine" ||
      urlInboxScope === "team" ||
      urlInboxScope === "unassigned" ||
      urlInboxScope === "collaborations" ||
      urlInboxScope === "blocked" ||
      urlInboxScope === "custom" ||
      urlInboxScope === "all"
    ) {
      const nextScope = urlInboxScope === "all" ? "all" : urlInboxScope;
      if (nextScope !== inboxScope) setInboxScope(nextScope);
    }
  }, [urlInboxScope, inboxScope]);

  useEffect(() => {
    if (urlOrganizationId && urlOrganizationId !== workspaceOrganizationId) {
      setWorkspaceOrganizationId(urlOrganizationId);
    }
  }, [urlOrganizationId, workspaceOrganizationId, setWorkspaceOrganizationId]);
  const customInboxesQuery = useQuery({
    queryKey: ["custom-inboxes", workspaceOrganizationId],
    queryFn: async () =>
      (
        await api.get<CustomInboxRow[]>("/inbox-tools/custom-inboxes", {
          params: workspaceOrganizationId ? { organization_id: workspaceOrganizationId } : undefined
        })
      ).data
  });
  const channelsQuery = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Array<{ id: string; name: string; type: string }>>("/channels")).data
  });
  const whatsappAccountsQuery = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });
  const instagramAccountsQuery = useQuery({
    queryKey: ["instagram-accounts"],
    queryFn: async () =>
      (
        await api.get<
          Array<{ id: string; channel_id: string; channel_name?: string | null; username?: string | null; page_name?: string | null; status: string }>
        >("/instagram/accounts")
      ).data
  });
  const conversations = conversationsQuery.data ?? [];
  const channelOptions = useMemo<ChannelOption[]>(() => {
    const waByChannel = new Map((whatsappAccountsQuery.data ?? []).map((item) => [item.channel_id, item]));
    const igByChannel = new Map((instagramAccountsQuery.data ?? []).map((item) => [item.channel_id, item]));
    return (channelsQuery.data ?? []).map((item) => {
      if (item.type === "instagram") {
        const account = igByChannel.get(item.id);
        return {
          id: item.id,
          name: account?.channel_name ?? item.name,
          phone: account?.username ? `@${account.username}` : account?.page_name ?? null,
          type: item.type,
          messagingReady: true
        };
      }
      if (item.type === "whatsapp") {
        const account = waByChannel.get(item.id);
        return {
          id: item.id,
          name: account?.channel_name ?? item.name,
          phone: account?.display_phone_number ?? null,
          type: item.type,
          messagingReady: true
        };
      }
      return {
        id: item.id,
        name: item.name,
        phone: null,
        type: item.type,
        messagingReady: item.type === "whatsapp" || item.type === "instagram"
      };
    });
  }, [channelsQuery.data, whatsappAccountsQuery.data, instagramAccountsQuery.data]);
  const whatsappChannelOptions = useMemo(
    () =>
      (channelsQuery.data ?? [])
        .filter((item) => item.type === "whatsapp")
        .map((item) => {
          const option = channelOptions.find((row) => row.id === item.id);
          return option ?? { id: item.id, name: item.name, phone: null, type: "whatsapp", messagingReady: true };
        }),
    [channelsQuery.data, channelOptions]
  );
  const channelLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of channelOptions) {
      map.set(item.id, item.phone ? `${item.name} · ${item.phone}` : item.name);
    }
    return map;
  }, [channelOptions]);
  const channelScopedConversations = useMemo(
    () => conversations.filter((item) => !channelFilter || item.channel_id === channelFilter),
    [conversations, channelFilter]
  );
  const waitingCount = useMemo(
    () =>
      needsReplyOnly
        ? channelScopedConversations.length
        : channelScopedConversations.filter((item) => item.needs_reply).length,
    [channelScopedConversations, needsReplyOnly]
  );
  const requestedConversationId = searchParams.get("conversation");
  const filtered = useMemo(() => {
    const rows = channelScopedConversations.filter((item) => {
      const haystack = `${item.contact_name ?? ""} ${item.contact_address} ${item.last_message_text ?? ""}`.toLowerCase();
      const matchesSearch = haystack.includes(search.trim().toLowerCase());
      const matchesFilter = filter === "engaged" || filter === "all" || filter === "archived" || filter === "snoozed"
        || (filter === "unread" && (item.unread_count ?? 0) > 0)
        || (filter === "waiting" && item.needs_reply)
        || (filter === "mine" && Boolean(item.assigned_membership_id))
        || (filter === "starred" && item.is_starred);
      const matchesSla = !slaBreachedOnly || Boolean(item.sla_breached_at);
      return matchesSearch && matchesFilter && matchesSla;
    });
    // Waiting queue: oldest inbound needing a reply first (longest wait).
    if (filter === "waiting" || needsReplyOnly || slaBreachedOnly) {
      return sortWaitingOldestFirst(rows);
    }
    return rows;
  }, [channelScopedConversations, filter, search, needsReplyOnly, slaBreachedOnly]);

  const waitingConversations = useMemo(
    () =>
      needsReplyOnly
        ? filtered
        : channelScopedConversations.filter((item) => item.needs_reply),
    [needsReplyOnly, filtered, channelScopedConversations]
  );
  const oldestWaiting = useMemo(
    () => pickOldestWaitingConversation(waitingConversations),
    [waitingConversations]
  );
  const longestWaitMinutes = oldestWaiting?.waiting_minutes ?? null;
  const nextWaitingPreview = oldestWaiting?.last_message_text?.trim() || "رسالة واردة بانتظار الرد";

  useEffect(() => {
    // When opening «تنتظر الرد» (e.g. from dashboard), load up to the inbox
    // ceiling so the list length can match the attention card count.
    setListLimit(needsReplyOnly ? INBOX_CONVERSATIONS_LIMIT : INBOX_CONVERSATIONS_PAGE_SIZE);
  }, [showArchived, showSnoozed, engagedOnly, needsReplyOnly, channelFilter, workspaceOrganizationId, inboxScope, customInboxId]);

  useEffect(() => {
    if (!requestedConversationId) return;
    // Wait for the current filter query — an in-flight empty list must not
    // clear selection or bounce the pill back to «الكل».
    if (!conversationsQuery.isSuccess || conversationsQuery.isPlaceholderData) return;
    const match = conversations.find((item) => item.id === requestedConversationId);
    if (match) {
      setSelectedId((prev) => {
        if (prev !== match.id) {
          if (prev) persistDraftForSelected(prev);
          const draft = draftsByConversationRef.current[match.id] ?? "";
          queueMicrotask(() => setText(draft));
        }
        return match.id;
      });
      if (match.channel_id && match.channel_id !== channelFilter) {
        setChannelFilter(match.channel_id);
      }
      return;
    }
    // Thread not in this view (e.g. silent outbound on «نشط») — keep the
    // filter the user chose; drop the selection instead of forcing «الكل».
    if (!engagedOnly) return;
    setSelectedId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("conversation");
    setSearchParams(next, { replace: true });
  }, [
    requestedConversationId,
    conversations,
    channelFilter,
    engagedOnly,
    conversationsQuery.isSuccess,
    conversationsQuery.isPlaceholderData,
    searchParams,
    setSearchParams
  ]);

  useEffect(() => {
    if (!selectedId) return;
    const selected = conversations.find((item) => item.id === selectedId);
    if (!selected?.channel_id) return;
    if (channelFilter && selected.channel_id !== channelFilter) {
      setChannelFilter(selected.channel_id);
    }
  }, [selectedId, conversations, channelFilter]);

  function setChannelFilter(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("channel_id", value);
    else next.delete("channel_id");
    setSearchParams(next, { replace: true });
  }

  function persistDraftForSelected(currentId: string | null = selectedId) {
    if (currentId) {
      draftsByConversationRef.current[currentId] = textRef.current;
    }
  }

  function openConversation(conversation: Conversation) {
    persistDraftForSelected();
    if (listScrollRef.current) {
      savedListScrollRef.current = listScrollRef.current.scrollTop;
    }
    setSelectedId(conversation.id);
    setText(draftsByConversationRef.current[conversation.id] ?? "");
    setTranslatedDraft("");
    setInboundTranslations({});
    setComposerMoreOpen(false);
    const next = new URLSearchParams(searchParams);
    next.set("conversation", conversation.id);
    next.set("channel_id", conversation.channel_id);
    setSearchParams(next, { replace: true });
  }

  function clearConversationSelection() {
    persistDraftForSelected();
    setSelectedId(null);
    setText("");
    setTranslatedDraft("");
    setInboundTranslations({});
    setComposerMoreOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete("conversation");
    setSearchParams(next, { replace: true });
    requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = savedListScrollRef.current;
      }
    });
  }

  function openOldestWaiting() {
    if (!oldestWaiting) return;
    openConversation(oldestWaiting);
  }

  async function openConversationOnChannel(targetChannelId: string) {
    if (!selectedConversation) return;
    const existing = conversations.find(
      (item) =>
        item.channel_id === targetChannelId &&
        phonesMatch(item.contact_address, selectedConversation.contact_address) &&
        !item.archived_at
    );
    if (existing) {
      openConversation(existing);
      return;
    }

    setSwitchingChannelId(targetChannelId);
    try {
      const threads = await api.get<ChannelThread[]>("/conversations/channel-threads", {
        params: {
          phone: selectedConversation.contact_address,
          conversation_id: selectedConversation.id
        },
        ...silentRequest
      });
      const thread = threads.data.find((item) => item.channel_id === targetChannelId);
      if (thread) {
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
        setSelectedId(thread.conversation_id);
        const next = new URLSearchParams(searchParams);
        next.set("conversation", thread.conversation_id);
        next.set("channel_id", thread.channel_id);
        setSearchParams(next, { replace: true });
        toastStore.getState().show("تم فتح المحادثة على هذه القناة.", "success");
        return;
      }

      const result = await startConversationOnChannel({
        channel_id: targetChannelId,
        external_address: normalizeWhatsAppPhone(selectedConversation.contact_address),
        display_name: selectedConversation.contact_name
      });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setSelectedId(result.conversation_id);
      const next = new URLSearchParams(searchParams);
      next.set("conversation", result.conversation_id);
      next.set("channel_id", result.channel_id);
      setSearchParams(next, { replace: true });
      toastStore.getState().show(
        result.created ? "تم فتح محادثة جديدة على هذه القناة." : "تم فتح المحادثة على هذه القناة.",
        "success"
      );
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر فتح المحادثة على هذه القناة."), "error");
    } finally {
      setSwitchingChannelId(null);
    }
  }

  async function handleStartNewConversation(event: FormEvent) {
    event.preventDefault();
    const phone = newConversationPhone.trim();
    if (!newConversationChannelId || !phone) {
      toastStore.getState().show("اختر القناة وأدخل رقم WhatsApp.", "error");
      return;
    }
    const normalizedPhone = normalizeWhatsAppPhone(phone);
    if (normalizedPhone.length < 8) {
      toastStore.getState().show("رقم WhatsApp غير صالح. أدخل الرقم مع مفتاح الدولة.", "error");
      return;
    }
    setStartingConversation(true);
    try {
      // New/outbound threads may have no inbound yet — show under «الكل».
      setFilter("all");
      const result = await startConversationOnChannel({
        channel_id: newConversationChannelId,
        external_address: normalizedPhone,
        display_name: newConversationName.trim() || null
      });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.refetchQueries({ queryKey: ["conversations"] });
      setNewConversationOpen(false);
      setNewConversationPhone("");
      setNewConversationName("");
      setSelectedId(result.conversation_id);
      const next = new URLSearchParams(searchParams);
      next.set("conversation", result.conversation_id);
      next.set("channel_id", result.channel_id);
      setSearchParams(next, { replace: true });
      toastStore.getState().show(
        result.created ? "تم فتح محادثة جديدة." : "تم فتح المحادثة.",
        "success"
      );
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر بدء المحادثة."), "error");
    } finally {
      setStartingConversation(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    void api.post(`/conversations/${selectedId}/read`, undefined, silentRequest).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });
  }, [selectedId, queryClient]);

  useEffect(() => {
    setAiSuggestion(null);
    setAiSuggestionSource(null);
    setMatchedProducts([]);
    setMatchedArticles([]);
    setCopilotResult(null);
    setCopilotOpen(false);
    setMessageSearch("");
  }, [selectedId]);

  const messagesQuery = useQuery({
    queryKey: ["conversation-messages", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async ({ signal }) => (
      await api.get<Message[]>(`/conversations/${selectedId}/messages`, { signal, ...silentRequest })
    ).data,
    refetchInterval: selectedId ? 8_000 : false,
  });
  const contextQuery = useQuery({
    queryKey: ["conversation-context", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async ({ signal }) => (
      await api.get<ConversationContext>(`/conversations/${selectedId}/context`, { signal, ...silentRequest })
    ).data,
    refetchInterval: 20_000
  });

  const allTagsQuery = useQuery({ queryKey: ["tags"], queryFn: async () => (await api.get<Tag[]>("/inbox-tools/tags")).data });
  const conversationTagsQuery = useQuery({ queryKey: ["conversation-tags", selectedId], enabled: Boolean(selectedId), queryFn: async () => (await api.get<Tag[]>(`/inbox-tools/conversations/${selectedId}/tags`)).data });
  const notesQuery = useQuery({
    queryKey: ["conversation-notes", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await api.get<Note[]>(`/inbox-tools/conversations/${selectedId}/notes`)).data,
    refetchInterval: selectedId ? 12_000 : false
  });

  const whisperItems = useMemo(() => {
    return (notesQuery.data ?? [])
      .filter((note) => (note.kind ?? "note") === "whisper")
      .map(
        (note): WhisperBubble => ({
          id: `whisper-${note.id}`,
          kind: "whisper",
          text_body: note.body,
          author_name: note.author_name,
          created_at: note.created_at
        })
      );
  }, [notesQuery.data]);

  const visibleMessages = useMemo(() => {
    const rows: Array<Message | WhisperBubble> = [...(messagesQuery.data ?? []), ...whisperItems].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const term = messageSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((message) => {
      if ("kind" in message && message.kind === "whisper") {
        return `${message.text_body} ${message.author_name ?? ""}`.toLowerCase().includes(term);
      }
      const chat = message as Message;
      const haystack = `${chat.text_body ?? ""} ${chat.media_caption ?? ""} ${chat.media_filename ?? ""} ${chat.type}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [messagesQuery.data, whisperItems, messageSearch]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && selectedId) {
        event.preventDefault();
        messageSearchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data, whisperItems.length]);

  useEffect(() => {
    if (!canCoach) setWhisperMode(false);
  }, [canCoach]);
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    enabled: canViewUsers,
    queryFn: async () => (await api.get("/team/employees")).data
  });
  const selectedConversation = useMemo(() => conversations.find((item) => item.id === selectedId) ?? null, [conversations, selectedId]);
  const contactDetailQuery = useQuery({
    queryKey: ["inbox-contact", selectedConversation?.contact_id],
    enabled: Boolean(selectedConversation?.contact_id),
    queryFn: async () =>
      (
        await api.get<{ id: string; lifecycle_stage?: string }>(
          `/contacts/${selectedConversation!.contact_id}`
        )
      ).data
  });
  const csatQuery = useQuery({
    queryKey: ["conversation-csat", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () =>
      (
        await api.get<{
          score: number | null;
          comment: string | null;
          source: string | null;
          updated_at: string | null;
        }>(`/conversations/${selectedId}/csat`)
      ).data
  });
  const conversationAttachments = useMemo(() => {
    const mediaTypes = new Set(["image", "video", "audio", "document"]);
    return (messagesQuery.data ?? []).filter(
      (item) => mediaTypes.has(item.type) && Boolean(item.media_url)
    );
  }, [messagesQuery.data]);
  const agentSettingsQuery = useQuery({
    queryKey: ["knowledge-agent-settings", selectedConversation?.channel_id || "account"],
    queryFn: async () => {
      const channelId = selectedConversation?.channel_id;
      const suffix = channelId ? `?channel_id=${encodeURIComponent(channelId)}` : "";
      return (await api.get<AgentSettings>(`/knowledge/agent-settings${suffix}`)).data;
    }
  });
  const lastInboundForLab = useMemo(() => {
    return [...(messagesQuery.data ?? [])].reverse().find((m) => m.direction === "inbound" && m.text_body)?.text_body || "";
  }, [messagesQuery.data]);
  const aiLabHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedConversation?.channel_id) params.set("channel_id", selectedConversation.channel_id);
    params.set("lab", "1");
    if (lastInboundForLab) params.set("q", lastInboundForLab);
    return `/ai?${params.toString()}`;
  }, [selectedConversation?.channel_id, lastInboundForLab]);
  const repliesOrganizationId =
    selectedConversation?.organization_id ?? workspaceOrganizationId ?? undefined;
  const quickRepliesQuery = useQuery({
    queryKey: ["quick-replies", "inbox-picker", repliesOrganizationId],
    enabled: Boolean(selectedConversation),
    queryFn: async () => {
      const params: Record<string, string> = {};
      // Branch-scoped library only — do not filter by channel so all shared replies appear.
      if (repliesOrganizationId) params.organization_id = repliesOrganizationId;
      return (await api.get<QuickReply[]>("/inbox-tools/quick-replies", { params })).data;
    }
  });
  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<TemplateOption[]>("/templates")).data
  });
  const selectedChannelAccountId = useMemo(() => {
    if (!selectedConversation?.channel_id) return null;
    return (whatsappAccountsQuery.data ?? []).find(
      (item) => item.channel_id === selectedConversation.channel_id
    )?.id ?? null;
  }, [selectedConversation?.channel_id, whatsappAccountsQuery.data]);
  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((item) => {
      if (item.status !== "approved") return false;
      if (!selectedChannelAccountId) return true;
      return item.whatsapp_account_id === selectedChannelAccountId;
    }),
    [templatesQuery.data, selectedChannelAccountId]
  );
  const selectedTemplate = useMemo(
    () => approvedTemplates.find((item) => item.id === templateId) ?? null,
    [approvedTemplates, templateId]
  );
  const windowClosed = Boolean(selectedConversation?.requires_template);
  const isArchived = Boolean(selectedConversation?.archived_at);
  const quickReplies = quickRepliesQuery.data ?? [];
  const filteredQuickReplies = useMemo(() => {
    if (replyCategoryFilter === "all") return quickReplies;
    return quickReplies.filter((item) => (item.category || "general") === replyCategoryFilter);
  }, [quickReplies, replyCategoryFilter]);
  const topQuickReplies = useMemo(
    () => [...filteredQuickReplies].sort((a, b) => b.usage_count - a.usage_count || a.sort_order - b.sort_order).slice(0, 2),
    [filteredQuickReplies]
  );
  const cartSummary = useMemo(() => buildCartSummary(cartProducts), [cartProducts]);
  const replyCategoryOptions = useMemo(() => {
    const present = new Set(quickReplies.map((item) => item.category || "general"));
    return Object.entries(QUICK_REPLY_CATEGORIES).filter(([key]) => present.has(key));
  }, [quickReplies]);

  useEffect(() => {
    setSuggestedReplies([]);
    setSlashHint(null);
    if (!selectedId || isArchived || windowClosed) return;
    const inbound = [...(messagesQuery.data ?? [])].reverse().find((m) => m.direction === "inbound" && m.text_body);
    if (!inbound?.text_body) return;
    void api
      .post<QuickReply[]>("/inbox-tools/quick-replies/suggest", {
        query: inbound.text_body,
        organization_id: selectedConversation?.organization_id,
        channel_id: selectedConversation?.channel_id,
        limit: 3
      }, silentRequest)
      .then((result) => setSuggestedReplies(result.data))
      .catch(() => undefined);
  }, [selectedId, messagesQuery.data, selectedConversation?.organization_id, selectedConversation?.channel_id, isArchived, windowClosed]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && selectedId) {
        event.preventDefault();
        messageSearchRef.current?.focus();
        return;
      }
      if (!selectedId || isArchived || windowClosed) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "1" && topQuickReplies[0]) {
        event.preventDefault();
        void applyReplyTemplate(topQuickReplies[0].body, { quickReplyId: topQuickReplies[0].id });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "2" && topQuickReplies[1]) {
        event.preventDefault();
        void applyReplyTemplate(topQuickReplies[1].body, { quickReplyId: topQuickReplies[1].id });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, isArchived, windowClosed, topQuickReplies]);

  useEffect(() => {
    if (!selectedId || isArchived) return;
    const sendView = () => {
      void api.post(`/conversations/${selectedId}/presence/view`, undefined, silentRequest).catch(() => undefined);
    };
    sendView();
    const interval = window.setInterval(sendView, 20_000);
    return () => {
      window.clearInterval(interval);
      void api.delete(`/conversations/${selectedId}/presence/view`, silentRequest).catch(() => undefined);
    };
  }, [selectedId, isArchived]);

  useEffect(() => {
    const token = authStore.getState().accessToken;
    if (!token) return;

    const base = import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:8000/api/v1";
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;
    let closed = false;

    function connect() {
      ws = new WebSocket(`${base}/realtime/ws?token=${token}`);
      ws.onopen = () => {
        attempts = 0;
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as {
            type?: string;
            conversation_id?: string;
            suggestion?: string;
            source?: string;
            matched_products?: MatchedCatalogProduct[];
            matched_articles?: Array<{ id: string; title: string; category: string; body?: string }>;
          };
          const aiTypes = ["ai.catalog_suggestion", "ai.kb_suggestion", "ai.combined_suggestion"];
          if (aiTypes.includes(payload.type ?? "") && payload.conversation_id === selectedId) {
            setAiSuggestion(payload.suggestion ?? null);
            setAiSuggestionSource(payload.source ?? payload.type?.replace("ai.", "").replace("_suggestion", "") ?? null);
            setMatchedProducts(payload.matched_products ?? []);
            setMatchedArticles(payload.matched_articles ?? []);
          }
          const refreshMessages =
            payload.type === "message.received" ||
            payload.type === "message.sent" ||
            payload.type === "conversation.updated" ||
            payload.type === "whatsapp.updated" ||
            !payload.type;
          if (refreshMessages) {
            void queryClient.invalidateQueries({ queryKey: ["conversations"] });
            const targetConversation = payload.conversation_id ?? selectedId;
            if (targetConversation) {
              void queryClient.invalidateQueries({ queryKey: ["conversation-messages", targetConversation] });
            }
          }
        } catch {
          /* ignore non-json frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(1000 * 2 ** attempts, 15000);
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [queryClient, selectedId]);

  async function updateConversation(payload: Record<string, unknown>) {
    if (!selectedId) return;
    try {
      await api.patch(`/conversations/${selectedId}`, payload);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if ("assigned_membership_id" in payload) {
        await queryClient.invalidateQueries({ queryKey: ["conversation-notes", selectedId] });
      }
      toastStore.getState().show("تم تحديث المحادثة.", "success");
    } catch { toastStore.getState().show("تعذر تحديث المحادثة.", "error"); }
  }
  async function addTag(tagId: string) { if (!selectedId) return; await api.post(`/inbox-tools/conversations/${selectedId}/tags`, { tag_id: tagId }); await queryClient.invalidateQueries({ queryKey: ["conversation-tags", selectedId] }); }
  async function removeTag(tagId: string) { if (!selectedId) return; await api.delete(`/inbox-tools/conversations/${selectedId}/tags/${tagId}`); await queryClient.invalidateQueries({ queryKey: ["conversation-tags", selectedId] }); }
  async function saveNote() {
    if (!selectedId || !noteText.trim()) return;
    try { await api.post(`/inbox-tools/conversations/${selectedId}/notes`, { body: noteText.trim() }); setNoteText(""); await queryClient.invalidateQueries({ queryKey: ["conversation-notes", selectedId] }); toastStore.getState().show("تم حفظ الملاحظة.", "success"); }
    catch { toastStore.getState().show("تعذر حفظ الملاحظة.", "error"); }
  }
  async function handleAttachment(file: File) {
    if (!selectedId) return;
    if (windowClosed) {
      toastStore.getState().show("انتهت نافذة 24 ساعة — استخدم قالب WhatsApp.", "error");
      return;
    }
    if (file.size > 16 * 1024 * 1024) { toastStore.getState().show("حجم الملف أكبر من الحد المسموح 16MB.", "error"); return; }
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      const contentType = uploaded.content_type ?? "";
      const endpoint = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "document";
      const conversation = conversations.find((item) => item.id === selectedId);
      if (!conversation) throw new Error("Conversation not found");
      const accounts = await api.get("/whatsapp/accounts");
      const account = accounts.data.find((item: { channel_id: string }) => item.channel_id === conversation.channel_id);
      if (!account) throw new Error("WhatsApp account not found");
      await api.post(`/whatsapp/accounts/${account.id}/messages/${endpoint}`, { to: conversation.contact_address, media_url: uploaded.public_url, caption: text.trim() || null, filename: uploaded.filename });
      if (selectedId) delete draftsByConversationRef.current[selectedId];
      setText(""); await Promise.all([queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }), queryClient.invalidateQueries({ queryKey: ["conversations"] })]);
      toastStore.getState().show("تم إرسال المرفق.", "success");
    } catch { toastStore.getState().show("تعذر إرسال المرفق.", "error"); }
    finally { setUploading(false); }
  }
  async function applyComposerRewrite(promptKey: string) {
    const source = text.trim();
    if (!source) {
      toastStore.getState().show("اكتب النص أولاً ثم اختر تحسين الصياغة.", "error");
      return;
    }
    setRewritePromptKey(promptKey);
    setRewritingDraft(true);
    try {
      const result = await api.post<{ rewritten_text: string }>("/inbox-tools/rewrite", {
        text: source,
        prompt_key: promptKey
      });
      const rewritten = (result.data.rewritten_text || "").trim();
      if (!rewritten) {
        toastStore.getState().show("تعذر تحسين النص.", "error");
        return;
      }
      onComposerChange(rewritten);
      toastStore.getState().show("تم تحسين صياغة الرسالة.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر تحسين الصياغة. تأكد من المزود الخارجي."), "error");
    } finally {
      setRewritingDraft(false);
      setRewritePromptKey("");
    }
  }

  async function translateComposerDraft() {
    const source = text.trim();
    if (!source) {
      toastStore.getState().show("اكتب النص أولاً ثم اضغط ترجمة.", "error");
      return;
    }
    setTranslatingDraft(true);
    try {
      const result = await api.post<{ translated_text: string }>("/inbox-tools/translate", {
        text: source,
        source_lang: "ar",
        target_lang: translateTargetLang
      });
      setTranslatedDraft(result.data.translated_text || "");
      toastStore.getState().show("تمت الترجمة — راجع النص ثم أرسل.", "success");
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر الترجمة. تأكد من تفعيل المزود الخارجي."), "error");
    } finally {
      setTranslatingDraft(false);
    }
  }

  async function translateInboundMessage(messageId: string, sourceText: string) {
    const body = sourceText.trim();
    if (!body) return;
    setInboundTranslatingId(messageId);
    try {
      const result = await api.post<{ translated_text: string }>("/inbox-tools/translate", {
        text: body,
        target_lang: "ar"
      });
      setInboundTranslations((prev) => ({ ...prev, [messageId]: result.data.translated_text || "" }));
    } catch (error) {
      toastStore.getState().show(formatApiError(error, "تعذر ترجمة الرسالة الواردة."), "error");
    } finally {
      setInboundTranslatingId(null);
    }
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedId || !text.trim()) return;
    if (whisperMode) {
      if (!canCoach) {
        toastStore.getState().show("لا تملك صلاحية الإشراف داخل المحادثة.", "error");
        return;
      }
      setSending(true);
      try {
        await api.post(`/inbox-tools/conversations/${selectedId}/whispers`, {
          body: text.trim(),
          kind: "whisper"
        });
        if (selectedId) delete draftsByConversationRef.current[selectedId];
        setText("");
        setTranslatedDraft("");
        await queryClient.invalidateQueries({ queryKey: ["conversation-notes", selectedId] });
        toastStore.getState().show("تم إرسال الهمس للموظف فقط.", "success");
      } catch {
        toastStore.getState().show("تعذر إرسال الهمس الداخلي.", "error");
      } finally {
        setSending(false);
      }
      return;
    }
    if (windowClosed) {
      toastStore.getState().show("انتهت نافذة 24 ساعة — استخدم قالب WhatsApp.", "error");
      return;
    }
    const shouldClose = sendAndClose;
    setSending(true);
    try {
      let outboundText = text.trim();
      if (translateMode) {
        if (translatedDraft.trim()) {
          outboundText = translatedDraft.trim();
        } else {
          const result = await api.post<{ translated_text: string }>("/inbox-tools/translate", {
            text: outboundText,
            source_lang: "ar",
            target_lang: translateTargetLang
          });
          outboundText = (result.data.translated_text || "").trim();
          if (!outboundText) {
            throw new Error("EMPTY_TRANSLATION");
          }
          setTranslatedDraft(outboundText);
        }
      }
      await api.post(`/conversations/${selectedId}/messages/text`, { text: outboundText });
      if (selectedId) delete draftsByConversationRef.current[selectedId];
      setText("");
      setTranslatedDraft("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      ]);
      if (shouldClose) {
        setCloseDialogOpen(true);
      }
    } catch {
      toastStore.getState().show(
        translateMode
          ? "تعذر الترجمة أو الإرسال. تأكد من المزود الخارجي ونافذة 24 ساعة."
          : "تعذر إرسال الرسالة. قد تكون نافذة 24 ساعة منتهية.",
        "error"
      );
    } finally {
      setSending(false);
    }
  }
  async function handleSendTemplate(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedId || !templateId) return;
    setSendingTemplate(true);
    try {
      await api.post(`/conversations/${selectedId}/messages/template`, { template_id: templateId });
      setTemplateId("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      ]);
      toastStore.getState().show("تم إرسال القالب.", "success");
    } catch {
      toastStore.getState().show("تعذر إرسال القالب.", "error");
    } finally {
      setSendingTemplate(false);
    }
  }
  async function handleSendReplyButtons() {
    if (!selectedId || windowClosed || isArchived) return;
    const body = (replyButtonBody.trim() || text.trim());
    const titles = replyButtonTitles
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!body || titles.length < 1) {
      toastStore.getState().show("أدخل نص الرسالة وزرًا واحدًا على الأقل.", "error");
      return;
    }
    setSendingReplyButtons(true);
    try {
      await api.post(`/conversations/${selectedId}/messages/reply-buttons`, {
        body,
        buttons: titles.map((title, index) => ({ id: `btn_${index + 1}`, title: title.slice(0, 20) }))
      });
      setReplyButtonsOpen(false);
      setReplyButtonBody("");
      setText("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      ]);
      toastStore.getState().show("تم إرسال الأزرار.", "success");
    } catch {
      toastStore.getState().show("تعذر إرسال الأزرار — تأكد أن نافذة 24 ساعة مفتوحة.", "error");
    } finally {
      setSendingReplyButtons(false);
    }
  }
  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" && slashHint && !event.shiftKey) {
      event.preventDefault();
      void applyReplyTemplate(slashHint.body, { quickReplyId: slashHint.id });
      setSlashHint(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  async function submitCsat() {
    if (!selectedId || !csatScore) return;
    try {
      await api.post(`/conversations/${selectedId}/csat`, { score: Number(csatScore) });
      setCsatScore("");
      await queryClient.invalidateQueries({ queryKey: ["conversation-csat", selectedId] });
      toastStore.getState().show("تم حفظ تقييم CSAT.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ التقييم.", "error");
    }
  }
  async function toggleStar() {
    if (!selectedConversation) return;
    await updateConversation({ is_starred: !selectedConversation.is_starred });
  }
  async function snoozeUntil(until: Date) {
    if (!selectedId) return;
    await updateConversation({ snoozed_until: until.toISOString() });
    setSnoozeOpen(false);
  }
  async function snoozeHours(hours: number) {
    await snoozeUntil(new Date(Date.now() + hours * 3600000));
  }
  async function unarchiveConversation() {
    await updateConversation({ archived: false });
    setFilter("engaged");
    toastStore.getState().show("تم استرجاع المحادثة.", "success");
  }
  async function summarizeClosingNote() {
    if (!selectedId) return;
    setClosingSummarizing(true);
    try {
      const result = await api.post<{ summary?: string }>("/knowledge/copilot", {
        conversation_id: selectedId
      });
      const summary = String(result.data.summary || "").trim();
      if (!summary) {
        toastStore.getState().show("لم يُرجع التلخيص نصاً.", "error");
        return;
      }
      setCloseNote(summary.slice(0, 1000));
      toastStore.getState().show("تم توليد ملخص الإغلاق.", "success");
    } catch {
      toastStore.getState().show("تعذر تلخيص المحادثة.", "error");
    } finally {
      setClosingSummarizing(false);
    }
  }

  async function confirmCloseConversation() {
    setClosingBusy(true);
    try {
      const payload: Record<string, unknown> = { archived: true };
      const closing_note = closeNote.trim().slice(0, 1000);
      const closing_reason = closeReason.trim().slice(0, 120);
      if (closing_note) payload.closing_note = closing_note;
      if (closing_reason) payload.closing_reason = closing_reason;
      await updateConversation(payload);
      setCloseDialogOpen(false);
      setCloseNote("");
      setCloseReason("");
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toastStore.getState().show("تم إغلاق المحادثة.", "success");
    } catch {
      toastStore.getState().show("تعذر إغلاق المحادثة.", "error");
    } finally {
      setClosingBusy(false);
    }
  }
  async function archiveConversation() {
    setCloseNote("");
    setCloseReason("");
    setCloseDialogOpen(true);
  }

  function toggleChecked(id: string) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleSelectAllVisible() {
    const visibleIds = filtered.map((item) => item.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.includes(id));
    setCheckedIds(allSelected ? checkedIds.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...checkedIds, ...visibleIds])));
  }

  function clearChecked() {
    setCheckedIds([]);
  }

  async function archiveConversationIds(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return;
    if (!window.confirm(`حذف/أرشفة ${unique.length.toLocaleString("ar")} محادثة؟ يمكن استرجاعها من «مؤرشفة».`)) return;
    setBulkBusy(true);
    try {
      await Promise.all(unique.map((id) => api.patch(`/conversations/${id}`, { archived: true })));
      setCheckedIds((current) => current.filter((id) => !unique.includes(id)));
      if (selectedId && unique.includes(selectedId)) setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toastStore.getState().show("تم أرشفة المحادثات المحددة.", "success");
    } catch {
      toastStore.getState().show("تعذر أرشفة بعض المحادثات.", "error");
    } finally {
      setBulkBusy(false);
    }
  }
  async function createCustomInbox() {
    const name = newCustomInboxName.trim();
    if (!name) return;
    try {
      await api.post("/inbox-tools/custom-inboxes", {
        name,
        organization_id: workspaceOrganizationId || null,
        filters: { needs_reply: true }
      });
      setNewCustomInboxName("");
      await customInboxesQuery.refetch();
      toastStore.getState().show("تم إنشاء إنبوكس مخصص.", "success");
    } catch {
      toastStore.getState().show("تعذر إنشاء الإنبوكس.", "error");
    }
  }
  async function saveShortcutNote(kind: "ticket" | "order", details: string) {
    if (!selectedId) return;
    const label = kind === "ticket" ? "تذكرة دعم" : "طلب / أوردر";
    const textBody = details.trim();
    if (!textBody) return;
    try {
      await api.post(`/inbox-tools/conversations/${selectedId}/notes`, {
        body: `${label}: ${textBody}`
      });
      await queryClient.invalidateQueries({ queryKey: ["conversation-notes", selectedId] });
      await queryClient.invalidateQueries({ queryKey: ["conversation-timeline", selectedId] });
      toastStore.getState().show(`تم حفظ ${label}.`, "success");
    } catch {
      toastStore.getState().show("تعذر حفظ الملاحظة.", "error");
    }
  }
  async function applyReplyTemplate(
    body: string,
    options?: { articleId?: string; quickReplyId?: string; closePicker?: boolean }
  ) {
    if (!selectedId) return;
    try {
      const result = await api.post(`/conversations/${selectedId}/render-text`, { text: body });
      setText(result.data.text as string);
    } catch {
      setText(body);
    }
    if (options?.articleId) {
      void api.post(`/knowledge/${options.articleId}/usage`, undefined, silentRequest).catch(() => undefined);
    }
    if (options?.quickReplyId) {
      void api.post(`/inbox-tools/quick-replies/${options.quickReplyId}/usage`, undefined, silentRequest).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
    }
    if (options?.closePicker !== false) {
      setSnippetsOpen(false);
      setSlashHint(null);
    }
  }
  async function saveLastOutboundAsQuickReply() {
    if (!selectedId) return;
    try {
      await api.post("/inbox-tools/quick-replies/from-conversation", { conversation_id: selectedId });
      toastStore.getState().show("تم حفظ آخر رد كرد سريع.", "success");
      void queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
    } catch {
      toastStore.getState().show("تعذر الحفظ — تأكد من وجود رسالة صادرة.", "error");
    }
  }
  function onComposerChange(value: string) {
    setText(value);
    setTranslatedDraft("");
    if (selectedId) draftsByConversationRef.current[selectedId] = value;
    setSlashHint(matchShortcutAutocomplete(value, quickReplies));
    if (!selectedId || isArchived) return;
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      void api.post(`/conversations/${selectedId}/presence/typing`, undefined, silentRequest).catch(() => undefined);
    }, 350);
  }
  async function aiSuggest() {
    const inbound = [...(messagesQuery.data ?? [])].reverse().find((m) => m.direction === "inbound" && m.text_body);
    const mode = agentSettingsQuery.data?.default_mode ?? "kb_first";
    try {
      const result = await api.post<SmartReplyResult>("/knowledge/suggest-reply", {
        query: inbound?.text_body || text || "مرحباً",
        contact_name: selectedConversation?.contact_name || "",
        mode,
        channel_id: selectedConversation?.channel_id || null
      });
      setAiSuggestion(result.data.suggestion);
      setAiSuggestionSource(result.data.source ?? null);
      setMatchedProducts(result.data.matched_products ?? []);
      setMatchedArticles(result.data.matched_articles ?? []);
      setText(result.data.suggestion);
    } catch {
      toastStore.getState().show("تعذر توليد اقتراح AI.", "error");
    }
  }

  async function runCopilot() {
    if (!selectedId) return;
    setCopilotLoading(true);
    setCopilotOpen(true);
    try {
      const result = await api.post<CopilotResult>("/knowledge/copilot", { conversation_id: selectedId });
      setCopilotResult(result.data);
    } catch {
      toastStore.getState().show("تعذر تشغيل Copilot.", "error");
      setCopilotOpen(false);
    } finally {
      setCopilotLoading(false);
    }
  }

  async function generateFaqFromConversation() {
    if (!selectedId) return;
    try {
      const draft = await api.post<{ title: string; body: string; category: string; keywords: string }>(
        "/knowledge/generate-from-conversation",
        { conversation_id: selectedId }
      );
      toastStore.getState().show(`تم توليد FAQ: ${draft.data.title}`, "success");
    } catch {
      toastStore.getState().show("تعذر توليد FAQ.", "error");
    }
  }

  async function createDealFromInbox(input?: { title?: string; amount?: string; stage?: DealStage }) {
    if (!selectedId) return;
    try {
      const deal = await createDealFromConversation(selectedId, input?.title || undefined);
      if (input?.amount) {
        await api.patch(`/platform/crm/deals/${deal.id}`, {
          amount: Number(input.amount) || 0
        });
      }
      if (input?.stage) {
        await api.patch(`/platform/crm/deals/${deal.id}/stage`, { stage: input.stage });
      }
      toastStore.getState().show(`تم إنشاء الصفقة: ${deal.title}`, "success");
      window.location.href = `/crm/${deal.id}`;
    } catch {
      toastStore.getState().show("تعذر إنشاء الصفقة.", "error");
    }
  }

  async function sendProductCard(product: MatchedCatalogProduct) {
    if (!selectedId || !product.id) return;
    if (windowClosed) {
      toastStore.getState().show("انتهت نافذة 24 ساعة — استخدم قالب WhatsApp.", "error");
      return;
    }
    setSending(true);
    try {
      await api.post(`/conversations/${selectedId}/messages/product`, {
        product_id: product.id,
        body: `إليك *${product.name}* — ${product.price_label}`
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      ]);
      toastStore.getState().show("تم إرسال بطاقة المنتج.", "success");
      setProductPickerOpen(false);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      if (detail === "COMMERCE_NOT_CONFIGURED") {
        toastStore.getState().show("فعّل Commerce واربط Meta Catalog ID من صفحة ربط WhatsApp.", "error");
      } else {
        toastStore.getState().show("تعذر إرسال بطاقة المنتج.", "error");
      }
    } finally {
      setSending(false);
    }
  }

  async function sendProductImage(product: MatchedCatalogProduct) {
    if (!selectedId || !product.image_url) return;
    if (windowClosed) {
      toastStore.getState().show("انتهت نافذة 24 ساعة — استخدم قالب WhatsApp.", "error");
      return;
    }
    setUploading(true);
    try {
      const conversation = conversations.find((item) => item.id === selectedId);
      if (!conversation) throw new Error("Conversation not found");
      const accounts = await api.get("/whatsapp/accounts");
      const account = accounts.data.find((item: { channel_id: string }) => item.channel_id === conversation.channel_id);
      if (!account) throw new Error("WhatsApp account not found");
      const caption = `${product.name} — ${product.price_label}`;
      await api.post(`/whatsapp/accounts/${account.id}/messages/image`, {
        to: conversation.contact_address,
        media_url: product.image_url,
        caption
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] })
      ]);
      toastStore.getState().show("تم إرسال صورة المنتج.", "success");
      setProductPickerOpen(false);
    } catch {
      toastStore.getState().show("تعذر إرسال صورة المنتج.", "error");
    } finally {
      setUploading(false);
    }
  }

  function insertCatalogProduct(line: string) {
    setText((current) => (current.trim() ? `${current.trim()}\n\n${line}` : line));
  }

  const inboxContext = contextQuery.data;
  const presenceLine = useMemo(() => {
    const typing = inboxContext?.typing ?? [];
    const viewers = inboxContext?.viewers ?? [];
    const coaches = viewers.filter((item) => item.coaching);
    const watchers = viewers.filter((item) => !item.coaching);
    if (typing.length) {
      return `${typing.map((item) => item.name).join("، ")} يكتب الآن…`;
    }
    const parts: string[] = [];
    if (coaches.length) {
      parts.push(`${coaches.map((item) => item.name).join("، ")} يشرف الآن (داخلي — لا يراه العميل)`);
    }
    if (watchers.length) {
      parts.push(`${watchers.map((item) => item.name).join("، ")} يشاهد المحادثة`);
    }
    return parts.length ? parts.join(" · ") : null;
  }, [inboxContext]);

  const filterLabels: Record<InboxFilter, string> = {
    engaged: "نشط",
    all: "الكل",
    unread: "غير مقروء",
    waiting: "تنتظر ردّي",
    mine: "المعيّنة لي",
    starred: "⭐ مميزة",
    snoozed: "مؤجلة",
    archived: "مؤرشفة"
  };
  const canLoadMore =
    !conversationsQuery.isLoading &&
    conversations.length >= listLimit &&
    listLimit < INBOX_CONVERSATIONS_LIMIT;
  const selectedIsSnoozed = isCurrentlySnoozed(selectedConversation?.snoozed_until);

  return (
    <main className={`inbox-workspace ${detailsOpen ? "details-open" : ""}`}>
      <aside className={`conversation-column ${selectedId ? "has-selection" : ""}`}>
        <div className="conversation-column-top">
          <div className="conversation-column-header">
            <div><span className="eyebrow">{t("eyebrow.unifiedInbox")}</span><h2>{t("pages.inbox")}</h2></div>
            <div className="inbox-column-actions">
              <button
                type="button"
                className="secondary-button compact inbox-new-conversation-button"
                onClick={() => {
                  setNewConversationOpen((value) => !value);
                  if (!newConversationChannelId && whatsappChannelOptions[0]) {
                    setNewConversationChannelId(
                      channelFilter && whatsappChannelOptions.some((item) => item.id === channelFilter)
                        ? channelFilter
                        : whatsappChannelOptions[0].id
                    );
                  }
                }}
              >
                + محادثة
              </button>
              <span className="count-badge">{channelScopedConversations.length}</span>
            </div>
          </div>
          {newConversationOpen && (
            <form className="inbox-new-conversation-panel" onSubmit={handleStartNewConversation}>
              <label className="field-label">
                <span>القناة</span>
                <select
                  value={newConversationChannelId}
                  onChange={(e) => setNewConversationChannelId(e.target.value)}
                  required
                >
                  <option value="">اختر قناة WhatsApp</option>
                  {whatsappChannelOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.phone ? `${item.name} · ${item.phone}` : item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                <span>رقم WhatsApp</span>
                <input
                  dir="ltr"
                  value={newConversationPhone}
                  onChange={(e) => setNewConversationPhone(e.target.value)}
                  placeholder="+965..."
                  required
                />
              </label>
              <label className="field-label">
                <span>اسم العميل (اختياري)</span>
                <input value={newConversationName} onChange={(e) => setNewConversationName(e.target.value)} />
              </label>
              <div className="admin-actions">
                <button type="submit" className="whatsapp-button compact" disabled={startingConversation}>
                  {startingConversation ? "جاري الفتح…" : "بدء المحادثة"}
                </button>
                <button type="button" className="secondary-button compact" onClick={() => setNewConversationOpen(false)}>
                  إلغاء
                </button>
              </div>
            </form>
          )}
          <div className="conversation-search"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم، رقم أو نص رسالة" aria-label="بحث في المحادثات" /></div>
          <div className="inbox-scope-tabs" role="tablist" aria-label="نوع الإنبوكس">
            {([
              ["all", "الكل"],
              ["mine", "لي"],
              ["team", "الفريق"],
              ["unassigned", "غير معيّنة"],
              ["collaborations", "مساعدات"],
              ["blocked", "محظورة"],
              ["custom", "مخصص"]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={inboxScope === value ? "active" : ""}
                onClick={() => {
                  setInboxScope(value);
                  if (value !== "custom") setCustomInboxId("");
                  const next = new URLSearchParams(searchParams);
                  if (value === "all") next.delete("inbox_scope");
                  else next.set("inbox_scope", value);
                  setSearchParams(next, { replace: true });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {inboxScope === "custom" && (
            <div className="inbox-custom-inbox-bar">
              <select
                value={customInboxId}
                onChange={(e) => setCustomInboxId(e.target.value)}
                aria-label="إنبوكس مخصص"
              >
                <option value="">اختر إنبوكس مخصص</option>
                {(customInboxesQuery.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <div className="inbox-custom-inbox-create">
                <input
                  value={newCustomInboxName}
                  onChange={(e) => setNewCustomInboxName(e.target.value)}
                  placeholder="اسم إنبوكس جديد"
                />
                <button type="button" className="secondary-button compact" onClick={() => void createCustomInbox()}>
                  +
                </button>
              </div>
            </div>
          )}
          {channelOptions.length > 1 && (
            <div className="inbox-channel-filter">
              <select
                id="inbox-channel-filter"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                aria-label="فلتر القناة"
              >
                <option value="">كل القنوات ({conversations.length})</option>
                {channelOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {CHANNEL_TYPE_SHORT[item.type] ?? item.type} · {item.phone ? `${item.name} · ${item.phone}` : item.name}
                    {!item.messagingReady ? " (قريباً)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-pills" role="tablist">
            {(["engaged", "all", "waiting", "unread", "mine", "starred", "snoozed", "archived"] as InboxFilter[]).map((value) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => {
                  setFilter(value);
                  const next = new URLSearchParams(searchParams);
                  if (value === "engaged") next.delete("filter");
                  else next.set("filter", value);
                  if (value === "waiting") next.set("needs_reply", "1");
                  else next.delete("needs_reply");
                  setSearchParams(next, { replace: true });
                }}
                title={
                  value === "engaged"
                    ? "محادثات تفاعل معها العميل (رسالة أو زر)"
                    : value === "all"
                      ? "كل المحادثات بما فيها من لم يرد بعد الحملات"
                      : undefined
                }
              >
                {filterLabels[value]}
                {value === "waiting" && waitingCount > 0 && ` (${waitingCount})`}
              </button>
            ))}
          </div>
        </div>
        {engagedOnly && filter === "engaged" && (
          <p className="hint-text inbox-list-limit-hint">
            يظهر من تفاعل معكم فقط — اختر «الكل» لإظهار من أُرسلت لهم حملات بلا رد.
          </p>
        )}
        {conversations.length >= INBOX_CONVERSATIONS_LIMIT && (
          <p className="hint-text inbox-list-limit-hint">
            يُعرض حتى {INBOX_CONVERSATIONS_LIMIT.toLocaleString("ar")} محادثة — استخدم البحث أو فلتر القناة للوصول لباقي العملاء.
          </p>
        )}
        {checkedIds.length > 0 && (
          <div className="inbox-bulk-bar" role="region" aria-label="إجراءات التحديد">
            <strong>محدد: {checkedIds.length.toLocaleString("ar")}</strong>
            <div className="inbox-bulk-actions">
              <button type="button" className="secondary-button compact" onClick={toggleSelectAllVisible}>
                {filtered.every((item) => checkedIds.includes(item.id)) && filtered.length > 0
                  ? "إلغاء تحديد الظاهر"
                  : "تحديد الظاهر"}
              </button>
              <button type="button" className="secondary-button compact" onClick={clearChecked}>
                إلغاء التحديد
              </button>
              <button
                type="button"
                className="whatsapp-button compact"
                disabled={bulkBusy || filter === "archived"}
                onClick={() => void archiveConversationIds(checkedIds)}
              >
                {bulkBusy ? "جاري الحذف…" : "حذف المحدد"}
              </button>
            </div>
          </div>
        )}
        <div className="conversation-scroll" ref={listScrollRef}>
          {(filter === "waiting" || needsReplyOnly) && (
            <div className="inbox-waiting-summary" role="status">
              <div className="inbox-waiting-summary-copy">
                <strong>{waitingConversations.length.toLocaleString("ar")} تنتظر الرد</strong>
                <span>
                  {longestWaitMinutes != null
                    ? `أقدم انتظار: ${formatWaitingMinutes(longestWaitMinutes)}`
                    : "لا محادثات بانتظار الرد الآن"}
                </span>
                {oldestWaiting && (
                  <small title={formatWaitingExactTime(oldestWaiting.last_inbound_at || oldestWaiting.last_message_at)}>
                    آخر طلب: {nextWaitingPreview}
                  </small>
                )}
              </div>
              <button
                type="button"
                className="whatsapp-button compact"
                disabled={!oldestWaiting}
                onClick={openOldestWaiting}
              >
                فتح أقدم محادثة تنتظر الرد
              </button>
            </div>
          )}
          {conversationsQuery.isLoading && Array.from({ length: 6 }).map((_, index) => <div className="conversation-skeleton" key={index}><span /><div><b /><i /></div></div>)}
          {conversationsQuery.isError && <div className="inbox-state error"><strong>تعذر تحميل المحادثات</strong><button onClick={() => conversationsQuery.refetch()}>إعادة المحاولة</button></div>}
          {!conversationsQuery.isLoading && filtered.length === 0 && <div className="inbox-state"><strong>لا توجد نتائج</strong><span>جرّب تغيير البحث أو الفلتر.</span></div>}
          {filtered.map((item) => {
            const isChecked = checkedIds.includes(item.id);
            return (
              <div
                className={`conversation-row ${selectedId === item.id ? "active" : ""}${item.needs_reply ? " needs-reply" : ""}${isChecked ? " checked" : ""}`}
                key={item.id}
              >
                <label className="conversation-row-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleChecked(item.id)}
                    aria-label={`تحديد محادثة ${item.contact_name || item.contact_address}`}
                  />
                </label>
                <button type="button" className="conversation-row-main" onClick={() => openConversation(item)}>
                  <div className="avatar avatar-soft">{(item.contact_name || item.contact_address).slice(0, 2).toUpperCase()}</div>
                  <div className="conversation-copy">
                    <div className="conversation-title-line">
                      <strong>{item.contact_name || item.contact_address}</strong>
                      <time>{item.last_message_at ? formatAppTime(item.last_message_at) : ""}</time>
                    </div>
                    {channelOptions.length > 1 && !channelFilter && (
                      <small className="inbox-channel-badge">{channelLabelById.get(item.channel_id) ?? "WhatsApp"}</small>
                    )}
                    <div className="conversation-preview">
                      <span>{item.last_message_text || "رسالة غير نصية"}</span>
                      {item.needs_reply && item.waiting_minutes != null && (
                        <small
                          className="waiting-badge"
                          title={formatWaitingExactTime(item.last_inbound_at || item.last_message_at) || undefined}
                        >
                          {formatWaitingMinutes(item.waiting_minutes)}
                        </small>
                      )}
                      {item.sla_breached_at && <small className="waiting-badge" style={{ background: "#ea4335" }}>SLA</small>}
                      {isCurrentlySnoozed(item.snoozed_until) && (
                        <small className="waiting-badge" style={{ background: "#64748b" }}>
                          مؤجلة {formatSnoozedUntil(item.snoozed_until)}
                        </small>
                      )}
                      {item.requires_template && <small className="window-badge closed">قالب</small>}
                      {(item.priority === "urgent" || item.priority === "high") && (
                        <small className={`priority-pill priority-${item.priority}`}>{priorityLabels[item.priority]}</small>
                      )}
                      {(item.unread_count ?? 0) > 0 && <b>{item.unread_count}</b>}
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
          {canLoadMore && (
            <div className="inbox-load-more">
              <button
                type="button"
                className="secondary-button"
                disabled={conversationsQuery.isFetching}
                onClick={() =>
                  setListLimit((current) =>
                    Math.min(current + INBOX_CONVERSATIONS_PAGE_SIZE, INBOX_CONVERSATIONS_LIMIT)
                  )
                }
              >
                {conversationsQuery.isFetching
                  ? "جاري التحميل…"
                  : `تحميل المزيد (${listLimit.toLocaleString("ar")} / ${INBOX_CONVERSATIONS_LIMIT.toLocaleString("ar")})`}
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className={`chat-column${!selectedId ? " chat-column-idle" : ""}`}>
        <header className="chat-header">
          <div className="chat-user">
            <button className="mobile-back-button" onClick={clearConversationSelection} aria-label="العودة للقائمة">‹</button>
            <div className="avatar avatar-online">{(selectedConversation?.contact_name || selectedConversation?.contact_address || "?").slice(0, 2).toUpperCase()}</div>
            <div>
              <h2>{selectedConversation?.contact_name || selectedConversation?.contact_address || t("inbox.selectConversation")}</h2>
              <span>
                {CHANNEL_TYPE_SHORT[channelOptions.find((item) => item.id === selectedConversation?.channel_id)?.type ?? "whatsapp"] ?? "WhatsApp"}
                {selectedConversation?.channel_id && channelLabelById.get(selectedConversation.channel_id)
                  ? ` · ${channelLabelById.get(selectedConversation.channel_id)}`
                  : ""}
                {" · "}{statusLabels[selectedConversation?.status ?? ""] ?? ""}
                {isArchived ? " · مؤرشفة" : ""}
                {selectedIsSnoozed
                  ? ` · مؤجلة حتى ${formatSnoozedUntil(selectedConversation?.snoozed_until)}`
                  : ""}
                {selectedConversation?.service_window_open
                  ? ` · نافذة نشطة (${formatWindowExpiry(selectedConversation.service_window_expires_at)})`
                  : selectedConversation ? " · يتطلب قالب" : ""}
              </span>
              {selectedConversation && channelOptions.length > 0 && (
                <div className="inbox-channel-switcher" aria-label="تبديل القناة">
                  {channelOptions.map((item) => {
                    const isActive = item.id === selectedConversation.channel_id;
                    const hasThread = conversations.some(
                      (row) =>
                        row.channel_id === item.id &&
                        phonesMatch(row.contact_address, selectedConversation.contact_address) &&
                        !row.archived_at
                    );
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={isActive ? "inbox-channel-pill active" : "inbox-channel-pill"}
                        disabled={switchingChannelId === item.id || (!item.messagingReady && !isActive)}
                        onClick={() => {
                          if (!item.messagingReady) {
                            toastStore.getState().show(`قناة ${CHANNEL_TYPE_SHORT[item.type] ?? item.type} قيد التفعيل — يمكن إنشاؤها من صفحة القنوات.`, "info");
                            return;
                          }
                          if (!isActive) void openConversationOnChannel(item.id);
                        }}
                        title={item.messagingReady ? (item.phone ?? item.name) : "قريباً — أنشئ القناة من صفحة القنوات"}
                      >
                        {switchingChannelId === item.id
                          ? "…"
                          : `${CHANNEL_TYPE_SHORT[item.type] ?? item.type}${!isActive && !hasThread && item.messagingReady ? " +" : ""}${!item.messagingReady ? " · قريباً" : ""}`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="chat-header-actions">
            <div className="snooze-menu-wrap">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setHeaderAssignOpen((value) => !value)}
                disabled={!selectedId || isArchived}
                title="تعيين موظف"
              >
                👤
              </button>
              {headerAssignOpen && selectedId && (
                <div className="snooze-menu inbox-assign-menu">
                  <button
                    type="button"
                    onClick={() => {
                      void updateConversation({ assigned_membership_id: null }).then(() => setHeaderAssignOpen(false));
                    }}
                  >
                    غير معيّنة
                  </button>
                  {(employeesQuery.data ?? []).map((item: { membership_id: string; full_name: string; role: string }) => (
                    <button
                      key={item.membership_id}
                      type="button"
                      onClick={() => {
                        void updateConversation({ assigned_membership_id: item.membership_id }).then(() =>
                          setHeaderAssignOpen(false)
                        );
                      }}
                    >
                      {item.full_name} · {item.role}
                    </button>
                  ))}
                  <button type="button" disabled>
                    مساعدون (بدون نقل التعيين)
                  </button>
                  {(employeesQuery.data ?? []).map((item: { membership_id: string; full_name: string; role: string }) => {
                    const current = selectedConversation?.collaborator_membership_ids ?? [];
                    const isHelper = current.includes(item.membership_id);
                    return (
                      <button
                        key={`helper-${item.membership_id}`}
                        type="button"
                        onClick={() => {
                          const next = isHelper
                            ? current.filter((id) => id !== item.membership_id)
                            : [...current, item.membership_id];
                          void updateConversation({ collaborator_membership_ids: next }).then(() =>
                            setHeaderAssignOpen(false)
                          );
                        }}
                      >
                        {isHelper ? "✓ " : "+ "}
                        {item.full_name} · مساعد
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button type="button" className="secondary-action" onClick={() => void toggleStar()} disabled={!selectedId}>{selectedConversation?.is_starred ? "★" : "☆"}</button>
            <div className="snooze-menu-wrap">
              <button type="button" className="secondary-action" onClick={() => setSnoozeOpen((value) => !value)} disabled={!selectedId || isArchived}>⏰</button>
              {snoozeOpen && selectedId && (
                <div className="snooze-menu">
                  <button type="button" onClick={() => void snoozeHours(1)}>1 ساعة</button>
                  <button type="button" onClick={() => void snoozeHours(4)}>4 ساعات</button>
                  <button type="button" onClick={() => void snoozeUntil(snoozeUntilTomorrowMorning())}>غداً 9 ص</button>
                  <button type="button" onClick={() => void updateConversation({ snoozed_until: null }).then(() => setSnoozeOpen(false))}>إلغاء التأجيل</button>
                </div>
              )}
            </div>
            {isArchived ? (
              <button type="button" className="secondary-action" onClick={() => void unarchiveConversation()} disabled={!selectedId} title="استرجاع">↩</button>
            ) : (
              <button type="button" className="secondary-action" onClick={() => void archiveConversation()} disabled={!selectedId} title="إغلاق">✕</button>
            )}
            <button type="button" className="secondary-action" onClick={() => void aiSuggest()} disabled={!selectedId || isArchived} title="اقتراح AI">AI</button>
            <Link className="secondary-action" to={aiLabHref} title="جرّب على آخر رسالة في مختبر الذكاء">
              مختبر
            </Link>
            <button type="button" className="secondary-action" onClick={() => void runCopilot()} disabled={!selectedId || isArchived || copilotLoading} title="Copilot">
              {copilotLoading ? "…" : "Copilot"}
            </button>
            {agentSettingsQuery.data && (
              <Link
                to={`/ai?channel_id=${encodeURIComponent(selectedConversation?.channel_id || "")}`}
                className={`inbox-ai-status-chip ${agentSettingsQuery.data.agent_enabled === false ? "is-off" : "is-on"}`}
                title={`الوكيل: ${agentSettingsQuery.data.agent_enabled === false ? "متوقف" : "يعمل"} · ${MODE_LABELS[agentSettingsQuery.data.default_mode] ?? agentSettingsQuery.data.default_mode} · LLM: ${llmStatusLabel(agentSettingsQuery.data)}`}
              >
                {agentSettingsQuery.data.agent_enabled === false
                  ? "وكيل متوقف"
                  : agentSettingsQuery.data.reply_mode?.label ||
                    MODE_LABELS[agentSettingsQuery.data.default_mode] ||
                    agentSettingsQuery.data.default_mode}
              </Link>
            )}
            <span className={`priority-badge priority-${selectedConversation?.priority ?? "normal"}`}>{priorityLabels[selectedConversation?.priority ?? "normal"]}</span>
            <button className="icon-button details-toggle" onClick={() => setDetailsOpen((value) => !value)} aria-label="تفاصيل العميل">•••</button>
          </div>
        </header>
        {selectedId && (
          <div className="conversation-message-search">
            <Icon name="search" />
            <input
              ref={messageSearchRef}
              value={messageSearch}
              onChange={(e) => setMessageSearch(e.target.value)}
              placeholder="بحث في المحادثة (Ctrl+F)"
              aria-label="بحث في المحادثة"
            />
            {messageSearch && (
              <button type="button" className="secondary-action" onClick={() => setMessageSearch("")}>×</button>
            )}
          </div>
        )}
        {presenceLine && selectedId && (
          <div className="inbox-presence-banner">{presenceLine}</div>
        )}
        <div className="messages premium-messages">
          {messagesQuery.isLoading && <div className="message-loading"><span /><span /><span /></div>}
          {messagesQuery.isError && <div className="inbox-state error"><strong>تعذر تحميل الرسائل</strong><button onClick={() => messagesQuery.refetch()}>إعادة المحاولة</button></div>}
          {!selectedId && (
            <div className="empty-conversation inbox-workbench-idle" aria-label="ملخص الانتظار">
              <h3>ماذا ينتظرك الآن؟</h3>
              {waitingConversations.length > 0 ? (
                <>
                  <p>
                    <strong>{waitingConversations.length.toLocaleString("ar")}</strong> محادثة تنتظر الرد
                    {longestWaitMinutes != null ? ` · أقدمها منذ ${formatWaitingMinutes(longestWaitMinutes)}` : ""}.
                  </p>
                  <div className="inbox-workbench-next">
                    <span>آخر طلب</span>
                    <strong title={formatWaitingExactTime(oldestWaiting?.last_inbound_at || oldestWaiting?.last_message_at)}>
                      {nextWaitingPreview}
                    </strong>
                    <small>
                      من {oldestWaiting?.contact_name || oldestWaiting?.contact_address || "عميل"}
                      {longestWaitMinutes != null
                        ? ` · ينتظر ${formatWaitingMinutes(longestWaitMinutes)}`
                        : ""}
                    </small>
                  </div>
                  <p className="inbox-workbench-step">الخطوة التالية: افتح أقدم محادثة واردة تحتاج ردًا.</p>
                  <button type="button" className="whatsapp-button" onClick={openOldestWaiting}>
                    فتح أقدم محادثة تنتظر الرد
                  </button>
                </>
              ) : (
                <>
                  <p>لا محادثات بانتظار الرد حاليًا. اختر محادثة من القائمة للمتابعة.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setFilter("waiting");
                      const next = new URLSearchParams(searchParams);
                      next.set("filter", "waiting");
                      next.set("needs_reply", "1");
                      next.delete("conversation");
                      setSearchParams(next, { replace: true });
                    }}
                  >
                    عرض قائمة الانتظار
                  </button>
                </>
              )}
            </div>
          )}
          {selectedId && !messagesQuery.isLoading && !messagesQuery.isError && (messagesQuery.data ?? []).length === 0 && <div className="empty-conversation"><h3>بداية محادثة جديدة</h3><p>أرسل أول رسالة من مربع الكتابة.</p></div>}
          {selectedId && !messagesQuery.isLoading && !messagesQuery.isError && messageSearch && visibleMessages.length === 0 && (
            <div className="inbox-state"><strong>لا توجد رسائل مطابقة</strong></div>
          )}
          {visibleMessages.map((message) => (
            <InboxMessageBubble
              key={message.id}
              message={message}
              formatTime={(value) => value ? formatAppTime(value) : ""}
              highlight={messageSearch.trim()}
              translation={
                !("kind" in message) && message.direction === "inbound"
                  ? inboundTranslations[message.id]
                  : undefined
              }
              translating={inboundTranslatingId === message.id}
              onTranslate={
                !("kind" in message) && message.direction === "inbound" && message.text_body
                  ? () => void translateInboundMessage(message.id, message.text_body || "")
                  : undefined
              }
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
        {isArchived && selectedId && (
          <div className="service-window-banner">
            <strong>محادثة مؤرشفة</strong>
            <p>لا يمكن الرد حتى تسترجع المحادثة من الأرشيف.</p>
            <button type="button" className="whatsapp-button" onClick={() => void unarchiveConversation()}>استرجاع المحادثة</button>
          </div>
        )}
        {windowClosed && selectedId && !isArchived && (
          <div className="service-window-banner">
            <strong>⏱ انتهت نافذة خدمة 24 ساعة</strong>
            <p>لا يمكن إرسال رسائل نصية حرة. استخدم قالب WhatsApp معتمد للمتابعة — كما في respond.io.</p>
          </div>
        )}
        {aiSuggestion && selectedId && !windowClosed && !isArchived && (
          <div className="ai-suggestion-banner">
            <strong>
              اقتراح {aiSourceLabels[aiSuggestionSource ?? ""] ?? SOURCE_LABELS[aiSuggestionSource ?? ""] ?? "ذكي"}
              {agentSettingsQuery.data?.default_mode
                ? ` · وضع ${MODE_LABELS[agentSettingsQuery.data.default_mode] ?? agentSettingsQuery.data.default_mode}`
                : ""}
            </strong>
            <WhatsAppTextPreview text={aiSuggestion} compact />
            {matchedArticles.length > 0 && (
              <div className="inbox-kb-list">
                {matchedArticles.map((article) => (
                  <article key={article.id} className="inbox-kb-card compact">
                    <strong>{article.title}</strong>
                    {article.body && <p>{article.body.slice(0, 100)}…</p>}
                  </article>
                ))}
              </div>
            )}
            {matchedProducts.length > 0 && (
              <div className="ai-suggestion-products">
                {matchedProducts.map((product) => (
                  <CatalogProductCard
                    key={product.id || product.name}
                    product={product}
                    compact
                    useLabel="استخدام"
                    onUse={() => setText(aiSuggestion)}
                    onSendImage={() => void sendProductImage(product)}
                    onSendProductCard={() => void sendProductCard(product)}
                  />
                ))}
              </div>
            )}
            <div className="ai-suggestion-actions">
              <button
                type="button"
                className="whatsapp-button"
                onClick={() => {
                  setText(aiSuggestion);
                  const top = matchedArticles[0];
                  if (top?.id) void sendArticleFeedback(top.id, true).catch(() => undefined);
                }}
              >
                استخدام الرد
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const top = matchedArticles[0];
                  if (top?.id) void sendArticleFeedback(top.id, false).catch(() => undefined);
                  setAiSuggestion(null);
                  setMatchedArticles([]);
                }}
              >
                غير مناسب
              </button>
              <button type="button" className="secondary-action" onClick={() => setAiSuggestion(null)}>إخفاء</button>
            </div>
          </div>
        )}
        {copilotOpen && selectedId && !isArchived && (
          <div className="inbox-copilot-panel">
            <div className="inbox-copilot-head">
              <strong>Copilot — ملخص واقتراحات</strong>
              <button type="button" className="secondary-action" onClick={() => setCopilotOpen(false)}>×</button>
            </div>
            {copilotLoading && <p className="hint-text">جاري التحليل…</p>}
            {copilotResult && (
              <>
                {copilotResult.summary && <p className="inbox-copilot-summary">{copilotResult.summary}</p>}
                {(copilotResult.intent || copilotResult.emotion) && (
                  <p className="hint-text">
                    {copilotResult.intent && `نية: ${copilotResult.intent.intent}`}
                    {copilotResult.emotion && ` · شعور: ${copilotResult.emotion.emotion}`}
                  </p>
                )}
                <div className="inbox-copilot-suggestions">
                  {(copilotResult.suggestions ?? []).map((item, index) => (
                    <article key={`${item.mode}-${index}`} className="inbox-kb-card">
                      <small>{aiSourceLabels[item.source ?? ""] ?? item.mode}</small>
                      <p>{item.text}</p>
                      <button type="button" className="secondary-button" onClick={() => setText(item.text)}>استخدام</button>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {windowClosed && selectedId && !isArchived && (
          <form className="composer template-composer" onSubmit={(e) => void handleSendTemplate(e)}>
            <div className="template-composer-scroll">
              <p className="hint-text window-closed-hint">
                انتهت نافذة 24 ساعة — لا يمكن إرسال رد حر. استخدم قالب WhatsApp معتمد أو انتظر رسالة جديدة من العميل.
              </p>
              <label className="field-label">
                <span>إرسال قالب معتمد</span>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                  <option value="">اختر القالب</option>
                  {approvedTemplates.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              {selectedTemplate && (
                <WhatsAppTemplatePreview
                  compact
                  bodyText={selectedTemplate.body_text}
                  components={selectedTemplate.components}
                  templateName={selectedTemplate.name}
                />
              )}
            </div>
            <div className="template-composer-actions">
              <button type="submit" className="whatsapp-button" disabled={!templateId || sendingTemplate}>
                {sendingTemplate ? "جاري الإرسال…" : "إرسال القالب"}
              </button>
            </div>
          </form>
        )}
        {!windowClosed && !isArchived && (
        <div className="chat-composer-shell">
        <form className="chat-composer-form" onSubmit={handleSend}>
          <div className="chat-composer-extras">
          {suggestedReplies.length > 0 && (
            <div className="inbox-suggested-replies">
              <span className="field-label-title">اقتراحات حسب آخر رسالة</span>
              <div className="inline-actions">
                {suggestedReplies.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="quick-reply-chip suggested"
                    title={item.body}
                    onClick={() => void applyReplyTemplate(item.body, { quickReplyId: item.id })}
                    disabled={!selectedId}
                  >
                    <strong>{item.title}</strong>
                    <small>{categoryLabel(item.category)}</small>
                    <span className="quick-reply-preview">{item.body.slice(0, 72)}{item.body.length > 72 ? "…" : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {snippetsOpen && (
            <div className="quick-replies-panel-inline inbox-reply-buttons-panel">
              <div className="inbox-product-picker-head">
                <strong>اختر رداً لإدراجه في المحادثة</strong>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setSnippetsOpen(false)}
                  aria-label="إغلاق"
                >
                  ×
                </button>
              </div>
              {quickRepliesQuery.isLoading ? (
                <p className="hint-text">جاري تحميل الردود…</p>
              ) : quickRepliesQuery.isError ? (
                <p className="hint-text">تعذر تحميل الردود. تأكد من صلاحياتك ثم أعد المحاولة.</p>
              ) : quickReplies.length === 0 ? (
                <p className="hint-text">
                  لا توجد ردود نشطة لهذا الفرع. أضفها من صفحة «مكتبة الرسائل» ثم ارجع هنا لاختيارها.
                </p>
              ) : (
                <>
                  {replyCategoryOptions.length > 0 && (
                    <div className="inbox-reply-category-chips">
                      <button
                        type="button"
                        className={`quick-reply-chip${replyCategoryFilter === "all" ? " suggested" : ""}`}
                        onClick={() => setReplyCategoryFilter("all")}
                      >
                        الكل
                      </button>
                      {replyCategoryOptions.map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          className={`quick-reply-chip${replyCategoryFilter === key ? " suggested" : ""}`}
                          onClick={() => setReplyCategoryFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="inbox-composer-library-list" role="listbox" aria-label="الردود الجاهزة">
                    {filteredQuickReplies.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        className="inbox-composer-library-card"
                        title={item.body}
                        disabled={!selectedId}
                        onClick={() =>
                          void applyReplyTemplate(item.body, {
                            quickReplyId: item.id,
                            closePicker: true
                          })
                        }
                      >
                        <strong>{item.title}</strong>
                        <span>{item.body}</span>
                        <small>
                          {item.shortcut} · {categoryLabel(item.category)}
                        </small>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {slashHint && (
            <div className="inbox-slash-hint">
              <span>Tab ← <strong>{slashHint.title}</strong></span>
              <code dir="ltr">{slashHint.shortcut}</code>
            </div>
          )}
          <div className="composer-toolbar" role="toolbar" aria-label="أدوات الكتابة">
            <button
              type="button"
              className={`composer-tool-btn${snippetsOpen ? " active" : ""}`}
              onClick={() => {
                setComposerMoreOpen(false);
                setSnippetsOpen((value) => {
                  const next = !value;
                  if (next) {
                    setShortcutsOpen(false);
                    setEmojiOpen(false);
                    setProductPickerOpen(false);
                    setReplyButtonsOpen(false);
                    setListMessageOpen(false);
                    setFlowSendOpen(false);
                    void queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
                  }
                  return next;
                });
              }}
              disabled={!selectedId}
              title="ردود من مكتبة الرسائل"
            >
              / ردود
            </button>
            <button
              type="button"
              className={`composer-tool-btn${emojiOpen ? " active" : ""}`}
              onClick={() => {
                setComposerMoreOpen(false);
                setEmojiOpen((value) => !value);
              }}
              disabled={!selectedId}
              title="Emoji"
            >
              ☺
            </button>
            <button
              type="button"
              className={`composer-tool-btn${productPickerOpen ? " active" : ""}`}
              onClick={() => {
                setComposerMoreOpen(false);
                setProductPickerOpen((value) => !value);
                setSnippetsOpen(false);
                setShortcutsOpen(false);
                setEmojiOpen(false);
                setReplyButtonsOpen(false);
                setListMessageOpen(false);
                setFlowSendOpen(false);
              }}
              disabled={!selectedId || isArchived}
              title="اختيار منتج من الكتالوج"
            >
              🛒 منتج
            </button>
            <div className="composer-more">
              <button
                type="button"
                className={`composer-tool-btn${composerMoreOpen || shortcutsOpen || replyButtonsOpen || listMessageOpen || flowSendOpen ? " active" : ""}`}
                onClick={() => {
                  setComposerMoreOpen((value) => !value);
                  setSnippetsOpen(false);
                  setEmojiOpen(false);
                  setProductPickerOpen(false);
                }}
                disabled={!selectedId}
                title="المزيد من أدوات الكتابة"
                aria-expanded={composerMoreOpen}
              >
                المزيد
              </button>
              {composerMoreOpen && (
                <div className="composer-more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={shortcutsOpen ? "active" : undefined}
                    onClick={() => {
                      setShortcutsOpen((value) => !value);
                      setReplyButtonsOpen(false);
                      setListMessageOpen(false);
                      setFlowSendOpen(false);
                      setComposerMoreOpen(false);
                    }}
                    disabled={isArchived}
                  >
                    ⚡ اختصارات
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={replyButtonsOpen ? "active" : undefined}
                    onClick={() => {
                      setReplyButtonsOpen((value) => !value);
                      setListMessageOpen(false);
                      setShortcutsOpen(false);
                      setFlowSendOpen(false);
                      if (!replyButtonBody.trim() && text.trim()) setReplyButtonBody(text);
                      setComposerMoreOpen(false);
                    }}
                    disabled={isArchived || windowClosed}
                  >
                    أزرار
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={listMessageOpen ? "active" : undefined}
                    onClick={() => {
                      setListMessageOpen((value) => !value);
                      setReplyButtonsOpen(false);
                      setShortcutsOpen(false);
                      setFlowSendOpen(false);
                      setComposerMoreOpen(false);
                    }}
                    disabled={isArchived || windowClosed}
                  >
                    قائمة
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={flowSendOpen ? "active" : undefined}
                    onClick={() => {
                      setFlowSendOpen((value) => !value);
                      setShortcutsOpen(false);
                      setReplyButtonsOpen(false);
                      setListMessageOpen(false);
                      setComposerMoreOpen(false);
                    }}
                    disabled={isArchived}
                  >
                    Flow
                  </button>
                </div>
              )}
            </div>
          </div>
          <InboxShortcutsMenu
            open={shortcutsOpen}
            disabled={!selectedId || isArchived}
            cartSummary={cartSummary}
            onClose={() => setShortcutsOpen(false)}
            onCreateDeal={(input) => void createDealFromInbox(input)}
            onCreateTicketNote={(details) => void saveShortcutNote("ticket", details)}
            onCreateOrderNote={(details) => void saveShortcutNote("order", details)}
          />
          <InboxEmojiPicker
            open={emojiOpen}
            onClose={() => setEmojiOpen(false)}
            onPick={(emoji) => setText((current) => `${current}${emoji}`)}
          />
          <div className="composer-variable-row">
            {REPLY_VARIABLES.map((item) => (
              <button
                key={item.token}
                type="button"
                className="quick-reply-chip"
                onClick={() => setText((current) => insertReplyVariable(current, item.token))}
                disabled={!selectedId}
              >
                {item.label}
              </button>
            ))}
          </div>
          <InboxListMessagePanel
            open={listMessageOpen}
            conversationId={selectedId}
            organizationId={selectedConversation?.organization_id ?? workspaceOrganizationId ?? null}
            onClose={() => setListMessageOpen(false)}
            onSent={() => {
              void queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] });
              void queryClient.invalidateQueries({ queryKey: ["conversations"] });
            }}
          />
          <InboxFlowSend
            open={flowSendOpen}
            channelId={selectedConversation?.channel_id ?? null}
            contactAddress={selectedConversation?.contact_address ?? null}
            conversationId={selectedId}
            onClose={() => setFlowSendOpen(false)}
          />
          <InboxReplyButtonsPanel
            open={replyButtonsOpen}
            organizationId={selectedConversation?.organization_id ?? workspaceOrganizationId ?? null}
            body={replyButtonBody}
            titles={replyButtonTitles}
            sending={sendingReplyButtons}
            onBodyChange={setReplyButtonBody}
            onTitlesChange={setReplyButtonTitles}
            onSend={() => void handleSendReplyButtons()}
            onClose={() => setReplyButtonsOpen(false)}
          />
          <InboxProductPicker
            open={productPickerOpen}
            onClose={() => setProductPickerOpen(false)}
            disabled={!selectedId || isArchived || uploading}
            channelId={selectedConversation?.channel_id ?? null}
            onInsert={(line) => insertCatalogProduct(line)}
            onSendImage={(product) => void sendProductImage(product)}
            onSendProductCard={(product) => void sendProductCard(product)}
            onSendCartSummary={(summary, products) => {
              setCartProducts(products);
              insertCatalogProduct(summary);
              setText(summary);
              toastStore.getState().show("تم تجهيز ملخص الطلب في مربع الكتابة.", "success");
            }}
          />
          </div>
          {canCoach && (
            <div className="inbox-send-mode" aria-live="polite">
              <div className="inbox-send-mode-tabs" role="tablist" aria-label="وضع الإرسال">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!whisperMode}
                  className={`inbox-send-mode-tab inbox-send-mode-tab--customer${!whisperMode ? " active" : ""}`}
                  onClick={() => setWhisperMode(false)}
                >
                  <strong>للعميل</strong>
                  <span>واتساب ظاهر</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={whisperMode}
                  className={`inbox-send-mode-tab inbox-send-mode-tab--whisper${whisperMode ? " active" : ""}`}
                  onClick={() => {
                    setWhisperMode(true);
                    setTranslateMode(false);
                  }}
                >
                  <strong>همس موظف</strong>
                  <span>داخلي فقط</span>
                </button>
              </div>
              <div
                className={`inbox-send-mode-banner${whisperMode ? " is-whisper" : " is-customer"}`}
                role="status"
              >
                {whisperMode
                  ? "الحالة الآن: همس داخلي للموظف — لا يُرسل لواتساب ولا يراه العميل"
                  : "الحالة الآن: رسالة للعميل عبر واتساب"}
              </div>
            </div>
          )}
          {!whisperMode && !isArchived && (
            <div className="inbox-translate-bar" aria-label="ترجمة وتحسين الإرسال">
              <label className="inbox-translate-toggle">
                <input
                  type="checkbox"
                  checked={translateMode}
                  onChange={(e) => {
                    setTranslateMode(e.target.checked);
                    if (!e.target.checked) setTranslatedDraft("");
                  }}
                  disabled={!selectedId || sending}
                />
                <span>ترجمة قبل الإرسال</span>
              </label>
              {translateMode && (
                <>
                  <select
                    value={translateTargetLang}
                    onChange={(e) => {
                      setTranslateTargetLang(e.target.value as "en" | "fr" | "ur" | "hi");
                      setTranslatedDraft("");
                    }}
                    aria-label="لغة الترجمة"
                    disabled={!selectedId || sending || translatingDraft}
                  >
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                    <option value="ur">اردو</option>
                    <option value="hi">हिन्दी</option>
                  </select>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => void translateComposerDraft()}
                    disabled={!selectedId || !text.trim() || sending || translatingDraft || rewritingDraft}
                  >
                    {translatingDraft ? "جاري الترجمة…" : "ترجم"}
                  </button>
                </>
              )}
              <select
                value=""
                aria-label="تحسين صياغة الرسالة"
                disabled={!selectedId || !text.trim() || sending || translatingDraft || rewritingDraft}
                onChange={(e) => {
                  const key = e.target.value;
                  if (key) void applyComposerRewrite(key);
                  e.currentTarget.value = "";
                }}
              >
                <option value="">{rewritingDraft ? "جاري التحسين…" : "تحسين الصياغة"}</option>
                <option value="tone_professional">نبرة رسمية</option>
                <option value="tone_friendly">نبرة ودّية</option>
                <option value="tone_empathetic">نبرة متعاطفة</option>
                <option value="tone_straightforward">مختصر ومباشر</option>
                <option value="grammar">تصحيح إملائي</option>
                <option value="simplify">تبسيط اللغة</option>
              </select>
              {translateMode && (
                <small className="inbox-translate-hint">
                  عند التفعيل يُرسل النص المترجم فقط — وبدون التفعيل يُرسل النص الأصلي.
                </small>
              )}
            </div>
          )}
          {translateMode && !whisperMode && translatedDraft && (
            <div className="inbox-translate-preview" role="status">
              <strong>معاينة الإرسال المترجم</strong>
              <p dir="auto">{translatedDraft}</p>
            </div>
          )}
          <div className={`chat-composer-bar${whisperMode ? " whisper-mode" : " customer-mode"}`}>
            <label className="composer-icon-button" title="إرفاق ملف">
              <input type="file" accept="image/*,video/mp4,audio/*,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleAttachment(file); event.currentTarget.value = ""; }} disabled={!selectedId || uploading || whisperMode} />
              <Icon name="paperclip" />
            </label>
            <textarea
              className="composer-textarea"
              rows={2}
              placeholder={
                !selectedId
                  ? "اختر محادثة أولًا"
                  : whisperMode
                    ? "اكتب همساً داخلياً للموظف…"
                    : translateMode
                      ? "اكتب بالعربية ثم اضغط ترجم…"
                      : "اكتب رسالة… (/اختصار + Tab، Enter للإرسال)"
              }
              value={text}
              onChange={(e) => onComposerChange(e.target.value)}
              onKeyDown={composerKeyDown}
              disabled={!selectedId || sending}
              maxLength={4096}
            />
            <div className="composer-send-group">
              <button
                className={`send-button${whisperMode ? " send-button--whisper" : " send-button--customer"}`}
                type="submit"
                disabled={!selectedId || sending || !text.trim()}
                aria-label={whisperMode ? "إرسال همس داخلي" : "إرسال للعميل"}
                title={whisperMode ? "إرسال همس داخلي" : "إرسال للعميل"}
              >
                <Icon name="send" />
              </button>
              {!whisperMode && (
                <label className="composer-send-close" title="إرسال ثم إغلاق">
                  <input
                    type="checkbox"
                    checked={sendAndClose}
                    onChange={(e) => setSendAndClose(e.target.checked)}
                  />
                  <span>وإغلاق</span>
                </label>
              )}
            </div>
          </div>
          <div className="composer-meta composer-meta-compact">
            <small>{text.length}/4096 · {"{{contact.name}}"} · <button type="button" className="link-button" onClick={() => void saveLastOutboundAsQuickReply()} disabled={!selectedId}>حفظ آخر رد</button></small>
          </div>
        </form>
        </div>
        )}
        <InboxCloseDialog
          open={closeDialogOpen}
          note={closeNote}
          reason={closeReason}
          onNoteChange={setCloseNote}
          onReasonChange={setCloseReason}
          onCancel={() => setCloseDialogOpen(false)}
          onConfirm={() => void confirmCloseConversation()}
          onSummarize={() => void summarizeClosingNote()}
          busy={closingBusy}
          summarizing={closingSummarizing}
        />
      </section>

      <aside className="customer-panel"><button className="panel-close" onClick={() => setDetailsOpen(false)}>×</button><div className="customer-profile"><div className="avatar avatar-large">{(selectedConversation?.contact_name || selectedConversation?.contact_address || "?").slice(0, 2).toUpperCase()}</div><h3>{selectedConversation?.contact_name || "عميل"}</h3><span dir="ltr">{selectedConversation?.contact_address}</span>
        {selectedConversation && (
          <div className="customer-link-row">
            <Link to={`/contacts?q=${encodeURIComponent(selectedConversation.contact_address)}`} className="secondary-button">ملف العميل</Link>
            <Link to="/crm" className="secondary-button">CRM</Link>
            <button type="button" className="secondary-button" onClick={() => void createDealFromInbox()} disabled={!selectedId || isArchived}>
              صفقة CRM
            </button>
          </div>
        )}
        {selectedConversation && (
          <div className="customer-select-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => toggleChecked(selectedConversation.id)}
            >
              {checkedIds.includes(selectedConversation.id) ? "إلغاء التحديد" : "تحديد المحادثة"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isArchived || bulkBusy}
              onClick={() => void archiveConversationIds([selectedConversation.id])}
            >
              حذف المحادثة
            </button>
          </div>
        )}
      </div>
        {(inboxContext?.attribution?.source_campaign_name || inboxContext?.attribution?.source_tracked_link_name) && (
          <div className="customer-section">
            <h4>مصدر العميل</h4>
            {inboxContext.attribution.source_campaign_name && (
              <p className="inbox-attribution-row">
                <span>حملة</span>
                <Link to="/campaigns">{inboxContext.attribution.source_campaign_name}</Link>
              </p>
            )}
            {inboxContext.attribution.source_tracked_link_name && (
              <p className="inbox-attribution-row">
                <span>رابط تتبع</span>
                <strong>{inboxContext.attribution.source_tracked_link_name}</strong>
              </p>
            )}
          </div>
        )}
        {(inboxContext?.knowledge_articles ?? []).length > 0 && (
          <div className="customer-section">
            <h4>قاعدة المعرفة</h4>
            <p className="hint-text">مقالات ذات صلة بآخر رسالة العميل</p>
            <div className="inbox-kb-list">
              {(inboxContext?.knowledge_articles ?? []).map((article) => (
                <article key={article.id} className="inbox-kb-card">
                  <strong>{article.title}</strong>
                  <p>{article.body}</p>
                  <button type="button" className="secondary-button" onClick={() => void applyReplyTemplate(article.body, { articleId: article.id })} disabled={isArchived}>
                    استخدام كرد
                  </button>
                </article>
              ))}
            </div>
            <button type="button" className="secondary-button" onClick={() => void generateFaqFromConversation()} disabled={isArchived || !selectedId}>
              توليد FAQ من المحادثة
            </button>
          </div>
        )}
        <div className="customer-section"><h4>إدارة المحادثة</h4><label className="control-label"><span>الموظف المسؤول</span><select value={selectedConversation?.assigned_membership_id ?? ""} onChange={(e) => void updateConversation({ assigned_membership_id: e.target.value || null })}><option value="">غير معيّنة</option>{(employeesQuery.data ?? []).map((item: { membership_id: string; full_name: string; role: string }) => <option key={item.membership_id} value={item.membership_id}>{item.full_name} · {item.role}</option>)}</select></label><label className="control-label"><span>مرحلة Lifecycle</span><select value={contactDetailQuery.data?.lifecycle_stage ?? "lead"} disabled={!selectedConversation?.contact_id || isArchived || contactDetailQuery.isLoading} onChange={(e) => { const contactId = selectedConversation?.contact_id; if (!contactId) return; void api.patch(`/contacts/${contactId}`, { lifecycle_stage: e.target.value }).then(() => queryClient.invalidateQueries({ queryKey: ["inbox-contact", contactId] })).then(() => toastStore.getState().show("تم تحديث مرحلة العميل.", "success")).catch(() => toastStore.getState().show("تعذر تحديث المرحلة.", "error")); }}><option value="lead">استفسار جديد</option><option value="qualified">اكتملت البيانات</option><option value="proposal">أُرسل العرض</option><option value="won">تم الحجز</option><option value="customer">عميل</option><option value="lost">خسارة</option><option value="churned">متوقف</option></select></label><label className="control-label"><span>الحالة</span><select value={selectedConversation?.status ?? "open"} onChange={(e) => void updateConversation({ status: e.target.value })}><option value="open">مفتوحة</option><option value="pending">قيد الانتظار</option><option value="closed">مغلقة</option><option value="spam">مزعجة</option></select></label><label className="control-label"><span>الأولوية</span><select value={selectedConversation?.priority ?? "normal"} onChange={(e) => void updateConversation({ priority: e.target.value })}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">مرتفعة</option><option value="urgent">عاجلة</option></select></label></div>
        <InboxCustomFieldsPanel contactId={selectedConversation?.contact_id ?? null} disabled={isArchived} />
        <InboxMergeSuggestions contactId={selectedConversation?.contact_id ?? null} disabled={isArchived} />
        <InboxTimeline conversationId={selectedId} />
        <div className="customer-section"><h4>الوسوم</h4><div className="tag-list">{(conversationTagsQuery.data ?? []).map((tag) => <button key={tag.id} onClick={() => void removeTag(tag.id)}>{tag.name} ×</button>)}</div><select className="tag-select" defaultValue="" onChange={(e) => { if (e.target.value) void addTag(e.target.value); e.currentTarget.value = ""; }}><option value="">إضافة وسم</option>{(allTagsQuery.data ?? []).filter((tag) => !(conversationTagsQuery.data ?? []).some((item) => item.id === tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>
        <div className="customer-section">
          <h4>المرفقات</h4>
          {conversationAttachments.length === 0 ? (
            <p className="hint-text">لا مرفقات في هذه المحادثة بعد.</p>
          ) : (
            <div className="notes-list">
              {conversationAttachments.map((item) => {
                const label =
                  item.type === "image"
                    ? "صورة"
                    : item.type === "video"
                      ? "فيديو"
                      : item.type === "audio"
                        ? "صوت"
                        : "ملف";
                const title = item.media_filename || item.media_caption || item.text_body || label;
                return (
                  <article key={item.id}>
                    <p>
                      <a href={item.media_url ?? "#"} target="_blank" rel="noreferrer">
                        {label}: {title}
                      </a>
                    </p>
                    <small>
                      {item.direction === "inbound" ? "وارد" : "صادر"} ·{" "}
                      {new Date(item.created_at).toLocaleString("ar")}
                    </small>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <div className="customer-section">
          <h4>تقييم CSAT</h4>
          {csatQuery.data?.score != null ? (
            <p className="hint-text">
              آخر تقييم: <strong>{csatQuery.data.score}/5</strong>
              {csatQuery.data.comment ? ` — ${csatQuery.data.comment}` : ""}
              {csatQuery.data.source ? ` · المصدر: ${csatQuery.data.source}` : ""}
            </p>
          ) : (
            <p className="hint-text">لا تقييم محفوظ بعد. بعد إغلاق المحادثة — أو يُرسل العميل: تقييم:5</p>
          )}
          <div className="inline-actions">
            <select value={csatScore} onChange={(e) => setCsatScore(e.target.value)}>
              <option value="">—</option>
              <option value="5">5 ممتاز</option>
              <option value="4">4 جيد</option>
              <option value="3">3 متوسط</option>
              <option value="2">2 ضعيف</option>
              <option value="1">1 سيء</option>
            </select>
            <button type="button" className="secondary-button" onClick={() => void submitCsat()} disabled={!csatScore || !selectedId}>حفظ</button>
          </div>
        </div>
        <div className="customer-section"><h4>ملاحظات داخلية</h4><div className="notes-list">{(notesQuery.data ?? []).filter((note) => (note.kind ?? "note") !== "whisper").map((note) => <article key={note.id}><p>{note.body}</p><small>{new Date(note.created_at).toLocaleString("ar")}</small></article>)}</div><textarea placeholder="أضف ملاحظة للفريق…" value={noteText} onChange={(e) => setNoteText(e.target.value)} /><button className="secondary-action" onClick={() => void saveNote()} disabled={!noteText.trim()}>حفظ الملاحظة</button></div>
      </aside>
      {detailsOpen && <button className="customer-overlay" onClick={() => setDetailsOpen(false)} aria-label="إغلاق التفاصيل" />}
    </main>
  );
}
