import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { authStore } from "../stores/auth";
import { toastStore } from "../stores/toast";
import { uploadFile } from "../lib/uploads";
import { formatWindowExpiry } from "../lib/serviceWindow";
import { formatWaitingMinutes, snoozeUntilTomorrowMorning } from "../lib/inboxHelpers";
import { formatAppTime } from "../lib/language";
import { insertReplyVariable, REPLY_VARIABLES, type ConversationContext } from "../lib/replyVariables";
import {
  matchShortcutAutocomplete,
  type QuickReply
} from "../lib/quickReplyHelpers";
import { createDealFromConversation } from "../lib/crmHelpers";
import type { MatchedCatalogProduct } from "../lib/catalogHelpers";
import {
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
import InboxMessageBubble from "../components/InboxMessageBubble";
import type { Conversation, Message } from "../types/api";
import type { Tag, Note } from "../types/inbox";
import Icon from "../components/Icon";

type InboxFilter = "all" | "unread" | "waiting" | "mine" | "starred" | "archived";
type TemplateOption = { id: string; name: string; status: string; body_text: string | null; components: TemplateComponent[] | null };
const priorityLabels: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "مرتفعة", urgent: "عاجلة" };

export default function InboxPage() {
  const { t } = useTranslation();
  const statusLabels: Record<string, string> = useMemo(() => ({
    open: t("inbox.statusOpen"),
    pending: t("inbox.statusPending"),
    closed: t("inbox.statusClosed"),
    spam: t("inbox.statusSpam")
  }), [t]);
  const aiSourceLabels: Record<string, string> = useMemo(() => ({
    knowledge_base: t("inbox.sourceKnowledge"),
    catalog: t("inbox.sourceCatalog"),
    combined: t("inbox.sourceCombined"),
    local: t("inbox.sourceLocal"),
    "knowledge_base+llm": "KB + LLM",
    "catalog+llm": "Catalog + LLM",
    "combined+llm": `${t("inbox.sourceCombined")} + LLM`
  }), [t]);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [noteText, setNoteText] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSuggestionSource, setAiSuggestionSource] = useState<string | null>(null);
  const [matchedProducts, setMatchedProducts] = useState<MatchedCatalogProduct[]>([]);
  const [matchedArticles, setMatchedArticles] = useState<Array<{ id: string; title: string; category: string; body?: string }>>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotResult, setCopilotResult] = useState<CopilotResult | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [csatScore, setCsatScore] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [suggestedReplies, setSuggestedReplies] = useState<QuickReply[]>([]);
  const [slashHint, setSlashHint] = useState<QuickReply | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSearchRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  const showArchived = filter === "archived";
  const conversationsQuery = useQuery({
    queryKey: ["conversations", showArchived],
    queryFn: async () => (
      await api.get<Conversation[]>("/conversations", { params: { archived: showArchived } })
    ).data,
    refetchInterval: 30_000
  });
  const conversations = conversationsQuery.data ?? [];
  const waitingCount = useMemo(
    () => conversations.filter((item) => item.needs_reply).length,
    [conversations]
  );
  const requestedConversationId = searchParams.get("conversation");
  const filtered = useMemo(() => conversations.filter((item) => {
    const haystack = `${item.contact_name ?? ""} ${item.contact_address} ${item.last_message_text ?? ""}`.toLowerCase();
    const matchesSearch = haystack.includes(search.trim().toLowerCase());
    const matchesFilter = filter === "all" || filter === "archived"
      || (filter === "unread" && (item.unread_count ?? 0) > 0)
      || (filter === "waiting" && item.needs_reply)
      || (filter === "mine" && Boolean(item.assigned_membership_id))
      || (filter === "starred" && item.is_starred);
    return matchesSearch && matchesFilter;
  }), [conversations, filter, search]);

  useEffect(() => {
    if (requestedConversationId && conversations.some((item) => item.id === requestedConversationId)) setSelectedId(requestedConversationId);
    else if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, requestedConversationId, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    void api.post(`/conversations/${selectedId}/read`).then(() => {
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

  const agentSettingsQuery = useQuery({
    queryKey: ["knowledge-agent-settings"],
    queryFn: async () => (await api.get<AgentSettings>("/knowledge/agent-settings")).data
  });

  const messagesQuery = useQuery({
    queryKey: ["conversation-messages", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await api.get<Message[]>(`/conversations/${selectedId}/messages`)).data,
    refetchInterval: selectedId ? 2_000 : false,
  });
  const contextQuery = useQuery({
    queryKey: ["conversation-context", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => (await api.get<ConversationContext>(`/conversations/${selectedId}/context`)).data,
    refetchInterval: 10_000
  });

  const visibleMessages = useMemo(() => {
    const rows = messagesQuery.data ?? [];
    const term = messageSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((message) => {
      const haystack = `${message.text_body ?? ""} ${message.media_caption ?? ""} ${message.media_filename ?? ""} ${message.type}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [messagesQuery.data, messageSearch]);

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

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messagesQuery.data]);

  const allTagsQuery = useQuery({ queryKey: ["tags"], queryFn: async () => (await api.get<Tag[]>("/inbox-tools/tags")).data });
  const conversationTagsQuery = useQuery({ queryKey: ["conversation-tags", selectedId], enabled: Boolean(selectedId), queryFn: async () => (await api.get<Tag[]>(`/inbox-tools/conversations/${selectedId}/tags`)).data });
  const notesQuery = useQuery({ queryKey: ["conversation-notes", selectedId], enabled: Boolean(selectedId), queryFn: async () => (await api.get<Note[]>(`/inbox-tools/conversations/${selectedId}/notes`)).data });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: async () => (await api.get("/team/employees")).data });
  const selectedConversation = useMemo(() => conversations.find((item) => item.id === selectedId) ?? null, [conversations, selectedId]);
  const quickRepliesQuery = useQuery({
    queryKey: ["quick-replies", selectedConversation?.organization_id, selectedConversation?.channel_id],
    enabled: Boolean(selectedConversation),
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (selectedConversation?.organization_id) params.organization_id = selectedConversation.organization_id;
      if (selectedConversation?.channel_id) params.channel_id = selectedConversation.channel_id;
      return (await api.get<QuickReply[]>("/inbox-tools/quick-replies", { params })).data;
    }
  });
  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<TemplateOption[]>("/templates")).data
  });
  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((item) => item.status === "approved"),
    [templatesQuery.data]
  );
  const selectedTemplate = useMemo(
    () => approvedTemplates.find((item) => item.id === templateId) ?? null,
    [approvedTemplates, templateId]
  );
  const windowClosed = Boolean(selectedConversation?.requires_template);
  const isArchived = Boolean(selectedConversation?.archived_at);
  const quickReplies = quickRepliesQuery.data ?? [];
  const topQuickReplies = useMemo(
    () => [...quickReplies].sort((a, b) => b.usage_count - a.usage_count || a.sort_order - b.sort_order).slice(0, 2),
    [quickReplies]
  );

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
      })
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
      void api.post(`/conversations/${selectedId}/presence/view`).catch(() => undefined);
    };
    sendView();
    const interval = window.setInterval(sendView, 20_000);
    return () => {
      window.clearInterval(interval);
      void api.delete(`/conversations/${selectedId}/presence/view`).catch(() => undefined);
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
      setText(""); await Promise.all([queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }), queryClient.invalidateQueries({ queryKey: ["conversations"] })]);
      toastStore.getState().show("تم إرسال المرفق.", "success");
    } catch { toastStore.getState().show("تعذر إرسال المرفق.", "error"); }
    finally { setUploading(false); }
  }
  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedId || !text.trim()) return;
    if (windowClosed) {
      toastStore.getState().show("انتهت نافذة 24 ساعة — استخدم قالب WhatsApp.", "error");
      return;
    }
    setSending(true);
    try { await api.post(`/conversations/${selectedId}/messages/text`, { text: text.trim() }); setText(""); await Promise.all([queryClient.invalidateQueries({ queryKey: ["conversation-messages", selectedId] }), queryClient.invalidateQueries({ queryKey: ["conversations"] })]); }
    catch {
      toastStore.getState().show("تعذر إرسال الرسالة. قد تكون نافذة 24 ساعة منتهية.", "error");
    }
    finally { setSending(false); }
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
    setFilter("all");
    toastStore.getState().show("تم استرجاع المحادثة.", "success");
  }
  async function archiveConversation() {
    await updateConversation({ archived: true });
    setSelectedId(null);
    await queryClient.invalidateQueries({ queryKey: ["conversations", true] });
  }
  async function applyReplyTemplate(
    body: string,
    options?: { articleId?: string; quickReplyId?: string }
  ) {
    if (!selectedId) return;
    try {
      const result = await api.post(`/conversations/${selectedId}/render-text`, { text: body });
      setText(result.data.text as string);
    } catch {
      setText(body);
    }
    if (options?.articleId) {
      void api.post(`/knowledge/${options.articleId}/usage`).catch(() => undefined);
    }
    if (options?.quickReplyId) {
      void api.post(`/inbox-tools/quick-replies/${options.quickReplyId}/usage`).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["quick-replies"] });
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
    setSlashHint(matchShortcutAutocomplete(value, quickReplies));
    if (!selectedId || isArchived) return;
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      void api.post(`/conversations/${selectedId}/presence/typing`).catch(() => undefined);
    }, 350);
  }
  async function aiSuggest() {
    const inbound = [...(messagesQuery.data ?? [])].reverse().find((m) => m.direction === "inbound" && m.text_body);
    const mode = agentSettingsQuery.data?.default_mode ?? "kb_first";
    try {
      const result = await api.post<SmartReplyResult>("/knowledge/suggest-reply", {
        query: inbound?.text_body || text || "مرحباً",
        contact_name: selectedConversation?.contact_name || "",
        mode
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

  async function createDealFromInbox() {
    if (!selectedId) return;
    try {
      const deal = await createDealFromConversation(selectedId);
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
    if (typing.length) {
      return `${typing.map((item) => item.name).join("، ")} يكتب الآن…`;
    }
    if (viewers.length) {
      return `${viewers.map((item) => item.name).join("، ")} يشاهد المحادثة`;
    }
    return null;
  }, [inboxContext]);

  const filterLabels: Record<InboxFilter, string> = {
    all: "الكل",
    unread: "غير مقروء",
    waiting: "تنتظر ردّي",
    mine: "المعيّنة لي",
    starred: "⭐ مميزة",
    archived: "مؤرشفة"
  };

  return (
    <main className={`inbox-workspace ${detailsOpen ? "details-open" : ""}`}>
      <aside className={`conversation-column ${selectedId ? "has-selection" : ""}`}>
        <div className="conversation-column-header"><div><span className="eyebrow">{t("eyebrow.unifiedInbox")}</span><h2>{t("pages.inbox")}</h2></div><span className="count-badge">{conversations.length}</span></div>
        <div className="conversation-search"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم، رقم أو نص رسالة" aria-label="بحث في المحادثات" /></div>
        <div className="filter-pills" role="tablist">
          {(["all", "waiting", "unread", "mine", "starred", "archived"] as InboxFilter[]).map((value) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {filterLabels[value]}
              {value === "waiting" && waitingCount > 0 && ` (${waitingCount})`}
            </button>
          ))}
        </div>
        <div className="conversation-scroll">
          {conversationsQuery.isLoading && Array.from({ length: 6 }).map((_, index) => <div className="conversation-skeleton" key={index}><span /><div><b /><i /></div></div>)}
          {conversationsQuery.isError && <div className="inbox-state error"><strong>تعذر تحميل المحادثات</strong><button onClick={() => conversationsQuery.refetch()}>إعادة المحاولة</button></div>}
          {!conversationsQuery.isLoading && filtered.length === 0 && <div className="inbox-state"><strong>لا توجد نتائج</strong><span>جرّب تغيير البحث أو الفلتر.</span></div>}
          {filtered.map((item) => (
            <button className={`conversation-row ${selectedId === item.id ? "active" : ""}${item.needs_reply ? " needs-reply" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
            <div className="avatar avatar-soft">{(item.contact_name || item.contact_address).slice(0, 2).toUpperCase()}</div>
            <div className="conversation-copy">
              <div className="conversation-title-line">
                <strong>{item.contact_name || item.contact_address}</strong>
                <time>{item.last_message_at ? formatAppTime(item.last_message_at) : ""}</time>
              </div>
              <div className="conversation-preview">
                <span>{item.last_message_text || "رسالة غير نصية"}</span>
                {item.needs_reply && item.waiting_minutes != null && (
                  <small className="waiting-badge">{formatWaitingMinutes(item.waiting_minutes)}</small>
                )}
                {item.sla_breached_at && <small className="waiting-badge" style={{ background: "#ea4335" }}>SLA</small>}
                {item.requires_template && <small className="window-badge closed">قالب</small>}
                {(item.priority === "urgent" || item.priority === "high") && (
                  <small className={`priority-pill priority-${item.priority}`}>{priorityLabels[item.priority]}</small>
                )}
                {(item.unread_count ?? 0) > 0 && <b>{item.unread_count}</b>}
              </div>
            </div>
          </button>
          ))}
        </div>
      </aside>

      <section className="chat-column">
        <header className="chat-header">
          <div className="chat-user">
            <button className="mobile-back-button" onClick={() => setSelectedId(null)}>‹</button>
            <div className="avatar avatar-online">{(selectedConversation?.contact_name || selectedConversation?.contact_address || "?").slice(0, 2).toUpperCase()}</div>
            <div>
              <h2>{selectedConversation?.contact_name || selectedConversation?.contact_address || t("inbox.selectConversation")}</h2>
              <span>
                WhatsApp · {statusLabels[selectedConversation?.status ?? ""] ?? ""}
                {isArchived ? " · مؤرشفة" : ""}
                {selectedConversation?.service_window_open
                  ? ` · نافذة نشطة (${formatWindowExpiry(selectedConversation.service_window_expires_at)})`
                  : selectedConversation ? " · يتطلب قالب" : ""}
              </span>
            </div>
          </div>
          <div className="chat-header-actions">
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
              <button type="button" className="secondary-action" onClick={() => void unarchiveConversation()} disabled={!selectedId}>↩</button>
            ) : (
              <button type="button" className="secondary-action" onClick={() => void archiveConversation()} disabled={!selectedId}>🗄</button>
            )}
            <button type="button" className="secondary-action" onClick={() => void aiSuggest()} disabled={!selectedId || isArchived} title="اقتراح AI">AI</button>
            <button type="button" className="secondary-action" onClick={() => void runCopilot()} disabled={!selectedId || isArchived || copilotLoading} title="Copilot">
              {copilotLoading ? "…" : "Copilot"}
            </button>
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
          {!selectedId && <div className="empty-conversation"><div className="empty-conversation-icon">💬</div><h3>اختر محادثة</h3><p>ستظهر الرسائل وبيانات العميل هنا.</p></div>}
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
            <strong>🤖 اقتراح {aiSourceLabels[aiSuggestionSource ?? ""] ?? SOURCE_LABELS[aiSuggestionSource ?? ""] ?? "ذكي"}</strong>
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
              <button type="button" className="whatsapp-button" onClick={() => setText(aiSuggestion)}>استخدام الرد</button>
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
            <button type="submit" className="whatsapp-button" disabled={!templateId || sendingTemplate}>
              {sendingTemplate ? "جاري الإرسال…" : "إرسال القالب"}
            </button>
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
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(quickReplies.length > 0) && (
            <div className="quick-replies">
              {topQuickReplies.map((item, index) => (
                <button
                  key={`top-${item.id}`}
                  type="button"
                  className="quick-reply-chip top-used"
                  title={`${item.body} (Ctrl+${index + 1})`}
                  onClick={() => void applyReplyTemplate(item.body, { quickReplyId: item.id })}
                  disabled={!selectedId}
                >
                  {item.title}
                  <small dir="ltr">Ctrl+{index + 1}</small>
                </button>
              ))}
              {quickReplies.filter((item) => !topQuickReplies.some((top) => top.id === item.id)).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="quick-reply-chip"
                  title={item.body}
                  onClick={() => void applyReplyTemplate(item.body, { quickReplyId: item.id })}
                  disabled={!selectedId}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
          {slashHint && (
            <div className="inbox-slash-hint">
              <span>Tab ← <strong>{slashHint.title}</strong></span>
              <code dir="ltr">{slashHint.shortcut}</code>
            </div>
          )}
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
            <button
              type="button"
              className="quick-reply-chip"
              onClick={() => setProductPickerOpen((value) => !value)}
              disabled={!selectedId || isArchived}
            >
              🛒 منتج
            </button>
          </div>
          <InboxProductPicker
            open={productPickerOpen}
            onClose={() => setProductPickerOpen(false)}
            disabled={!selectedId || isArchived || uploading}
            onInsert={(line) => insertCatalogProduct(line)}
            onSendImage={(product) => void sendProductImage(product)}
            onSendProductCard={(product) => void sendProductCard(product)}
          />
          </div>
          <div className="chat-composer-bar">
            <label className="composer-icon-button" title="إرفاق ملف">
              <input type="file" accept="image/*,video/mp4,audio/*,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleAttachment(file); event.currentTarget.value = ""; }} disabled={!selectedId || uploading} />
              <Icon name="paperclip" />
            </label>
            <textarea
              className="composer-textarea"
              rows={2}
              placeholder={selectedId ? "اكتب رسالة… (/اختصار + Tab، Enter للإرسال)" : "اختر محادثة أولًا"}
              value={text}
              onChange={(e) => onComposerChange(e.target.value)}
              onKeyDown={composerKeyDown}
              disabled={!selectedId || sending}
              maxLength={4096}
            />
            <button className="send-button" type="submit" disabled={!selectedId || sending || !text.trim()} aria-label="إرسال">
              <Icon name="send" />
            </button>
          </div>
          <div className="composer-meta composer-meta-compact">
            <small>{text.length}/4096 · {"{{contact.name}}"} · <button type="button" className="link-button" onClick={() => void saveLastOutboundAsQuickReply()} disabled={!selectedId}>حفظ آخر رد</button></small>
          </div>
        </form>
        </div>
        )}
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
        <div className="customer-section"><h4>إدارة المحادثة</h4><label className="control-label"><span>الموظف المسؤول</span><select value={selectedConversation?.assigned_membership_id ?? ""} onChange={(e) => void updateConversation({ assigned_membership_id: e.target.value || null })}><option value="">غير معيّنة</option>{(employeesQuery.data ?? []).map((item: { membership_id: string; full_name: string; role: string }) => <option key={item.membership_id} value={item.membership_id}>{item.full_name} · {item.role}</option>)}</select></label><label className="control-label"><span>الحالة</span><select value={selectedConversation?.status ?? "open"} onChange={(e) => void updateConversation({ status: e.target.value })}><option value="open">مفتوحة</option><option value="pending">قيد الانتظار</option><option value="closed">مغلقة</option><option value="spam">مزعجة</option></select></label><label className="control-label"><span>الأولوية</span><select value={selectedConversation?.priority ?? "normal"} onChange={(e) => void updateConversation({ priority: e.target.value })}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">مرتفعة</option><option value="urgent">عاجلة</option></select></label></div>
        <div className="customer-section"><h4>الوسوم</h4><div className="tag-list">{(conversationTagsQuery.data ?? []).map((tag) => <button key={tag.id} onClick={() => void removeTag(tag.id)}>{tag.name} ×</button>)}</div><select className="tag-select" defaultValue="" onChange={(e) => { if (e.target.value) void addTag(e.target.value); e.currentTarget.value = ""; }}><option value="">إضافة وسم</option>{(allTagsQuery.data ?? []).filter((tag) => !(conversationTagsQuery.data ?? []).some((item) => item.id === tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>
        <div className="customer-section"><h4>تقييم CSAT</h4><p className="hint-text">بعد إغلاق المحادثة — أو يُرسل العميل: تقييم:5</p><div className="inline-actions"><select value={csatScore} onChange={(e) => setCsatScore(e.target.value)}><option value="">—</option><option value="5">5 ممتاز</option><option value="4">4 جيد</option><option value="3">3 متوسط</option><option value="2">2 ضعيف</option><option value="1">1 سيء</option></select><button type="button" className="secondary-button" onClick={() => void submitCsat()} disabled={!csatScore || !selectedId}>حفظ</button></div></div>
        <div className="customer-section"><h4>ملاحظات داخلية</h4><div className="notes-list">{(notesQuery.data ?? []).map((note) => <article key={note.id}><p>{note.body}</p><small>{new Date(note.created_at).toLocaleString("ar")}</small></article>)}</div><textarea placeholder="أضف ملاحظة للفريق…" value={noteText} onChange={(e) => setNoteText(e.target.value)} /><button className="secondary-action" onClick={() => void saveNote()} disabled={!noteText.trim()}>حفظ الملاحظة</button></div>
      </aside>
      {detailsOpen && <button className="customer-overlay" onClick={() => setDetailsOpen(false)} aria-label="إغلاق التفاصيل" />}
    </main>
  );
}
