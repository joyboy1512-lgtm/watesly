import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import {
  DAY_LABELS,
  DAY_ORDER,
  evaluateKnowledgeQuality,
  llmStatusLabel,
  MODE_LABELS,
  normalizeBusinessHours,
  type AgentSettings,
  type AgentSettingsPatch,
  type BusinessHoursConfig,
  type QualityEvalResult
} from "../lib/knowledgeHelpers";
import {
  buildStoredComponents,
  type TemplateButton,
  type TemplateHeaderFormat
} from "../lib/templateMedia";
import { type UploadedFile } from "../lib/uploads";
import { type WhatsAppAccountRow } from "../lib/whatsappHelpers";
import { toastStore } from "../stores/toast";

type PageTab = "ops" | "lab" | "templates" | "activity" | "settings";

type ReplyMode = {
  mode: "staff_handles" | "suggest_staff" | "auto_customer" | string;
  label: string;
  reason_code?: string;
  reason_text?: string;
  blockers?: Array<{ code: string; text: string; action: string }>;
  engine_ready?: boolean;
};

type EffectiveSettings = AgentSettings & {
  channel_id?: string | null;
  account_agent_enabled?: boolean;
  has_channel_override?: boolean;
  reply_mode?: ReplyMode;
  escalation_keywords?: string[];
  clarify_max_rounds?: number;
};

type SubscriptionInfo = {
  plan_name?: string;
  billing_cycle?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  cycle_month?: string;
  included_mac?: number | null;
  mac_remaining?: number | null;
  mac_count?: number | null;
  over_mac_price_per_100?: number | null;
  estimated_over_mac_charge?: number | null;
};

const DEFAULT_WELCOME =
  "شكراً لتواصلك معنا. يسعدنا خدمتك — كيف يمكننا مساعدتك اليوم؟";

type LabTurn = {
  role: "customer" | "assistant" | "system";
  text: string;
  meta?: Record<string, unknown>;
};

type ActivityRow = {
  id: string;
  channel_id?: string | null;
  created_at?: string | null;
  source: string;
  outcome: string;
  reason_text?: string | null;
  query_text?: string | null;
  suggestion?: string | null;
};

type AiTemplateDraft = {
  name: string;
  language: string;
  category: string;
  header_type: string;
  header_text: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
  image_prompt: string;
  notes: string;
};

type SavedDraft = {
  id: string;
  status: string;
  topic?: string | null;
  angle?: string | null;
  draft: AiTemplateDraft;
  internal_check?: { ok?: boolean; issues?: string[]; stage?: string };
  meta_status?: string | null;
};

type ReplyChoice = "staff" | "suggest" | "auto";

const TABS: Array<{ id: PageTab; label: string }> = [
  { id: "ops", label: "التشغيل" },
  { id: "lab", label: "التجربة" },
  { id: "templates", label: "القوالب" },
  { id: "activity", label: "سجل النشاط" },
  { id: "settings", label: "إعدادات الذكاء الاصطناعي" }
];

const REPLY_CHOICES: Array<{ id: ReplyChoice; title: string; hint: string }> = [
  { id: "staff", title: "الموظف يرد", hint: "الذكاء لا يقترح ولا يرسل تلقائياً." },
  { id: "suggest", title: "اقتراح للموظف", hint: "رد جاهز للمراجعة قبل الإرسال." },
  { id: "auto", title: "رد تلقائي", hint: "المساعد يرد على العميل مباشرة." }
];

function phoneLast4(phone?: string | null) {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.slice(-4) || "----";
}

function channelTitle(wa: WhatsAppAccountRow) {
  return `${wa.verified_name || wa.channel_name || "واتساب"} · ${phoneLast4(wa.display_phone_number)}`;
}

function modeClass(mode?: string) {
  if (mode === "auto_customer") return "is-auto";
  if (mode === "suggest_staff") return "is-suggest";
  return "is-staff";
}

function selectedReplyChoice(settings?: EffectiveSettings | null): ReplyChoice {
  if (!settings || settings.account_agent_enabled === false || settings.agent_enabled === false) {
    return "staff";
  }
  if (settings.auto_reply_on_inbound) return "auto";
  if (settings.auto_kb_on_inbound) return "suggest";
  return "staff";
}

function draftStatusMeta(item: SavedDraft) {
  const status = (item.status || "draft").toLowerCase();
  if (status === "submitted" || status === "pending" || item.meta_status === "PENDING") {
    return { label: "قيد المراجعة", className: "is-review" };
  }
  if (status === "approved" || item.meta_status === "APPROVED") {
    return { label: "معتمد", className: "is-approved" };
  }
  if (status === "rejected") {
    return { label: "مرفوض", className: "is-draft" };
  }
  return { label: "مسودة", className: "is-draft" };
}

function activityEventLabel(outcome: string) {
  const key = (outcome || "").toLowerCase();
  if (key.includes("welcome")) return { label: "ترحيب", className: "is-welcome" };
  if (key.includes("clarify")) return { label: "توضيح", className: "is-clarify" };
  if (key.includes("escalate")) return { label: "تحويل لموظف", className: "is-escalate" };
  if (key.includes("auto")) return { label: "رد تلقائي", className: "is-auto" };
  if (key.includes("skip")) return { label: "تخطي", className: "is-skip" };
  if (key.includes("fail") || key.includes("unresolved")) return { label: "تعذّر", className: "is-fail" };
  return { label: "اقتراح للموظف", className: "is-suggest" };
}

function formatActivityTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ar-KW", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short"
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractInterpretation(
  understood: Record<string, unknown> | null,
  dialogue: Record<string, unknown> | null
) {
  const products = Array.isArray(understood?.matched_products)
    ? (understood?.matched_products as Array<Record<string, unknown>>)
    : [];
  const pending = asRecord(dialogue?.pending_product);
  const top = products[0] || pending || null;
  const productName = top ? String(top.name || top.title || "—") : "—";
  const quantity =
    dialogue?.quantity ??
    top?.quantity ??
    (Array.isArray(dialogue?.cart) && dialogue?.cart[0]
      ? asRecord(dialogue.cart[0])?.quantity
      : null);
  const size =
    top?.variant_size ||
    top?.size_label ||
    asRecord(top?.size)?.label ||
    asRecord(understood?.parsed)?.size ||
    null;
  const weight =
    typeof size === "string" || typeof size === "number"
      ? String(size)
      : size && typeof size === "object"
        ? `${(size as { value?: unknown }).value ?? ""} ${(size as { unit?: unknown }).unit ?? ""}`.trim()
        : null;

  return {
    productName,
    quantity: quantity == null || quantity === "" ? null : String(quantity),
    weight: weight || null,
    needsClarification: Boolean(understood?.needs_clarification),
    source: understood?.source ? String(understood.source) : null,
    engine: understood?.engine ? String(understood.engine) : null
  };
}

export default function AiAgentPage() {
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<PageTab>(searchParams.get("lab") === "1" ? "lab" : "ops");
  const [channelId, setChannelId] = useState(searchParams.get("channel_id") || "");
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  const [activityRange, setActivityRange] = useState<"7" | "all">("all");
  const [providerPanel, setProviderPanel] = useState<"local" | "external" | null>(null);

  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState("");
  const [hoursDraft, setHoursDraft] = useState<BusinessHoursConfig | null>(null);
  const [hoursDirty, setHoursDirty] = useState(false);

  const [labContactName, setLabContactName] = useState("عميل");
  const [labInput, setLabInput] = useState(searchParams.get("q") || "");
  const [labTurns, setLabTurns] = useState<LabTurn[]>([]);
  const [labDialogue, setLabDialogue] = useState<Record<string, unknown> | null>(null);
  const [labBusy, setLabBusy] = useState(false);
  const [labAutostartDone, setLabAutostartDone] = useState(false);
  const [lastUnderstood, setLastUnderstood] = useState<Record<string, unknown> | null>(null);
  const [lastReason, setLastReason] = useState("");

  const [qualityCasesText, setQualityCasesText] = useState(
    "أبي حبتين rose soap ٩٥ غ\nخلّهم ثلاث\nبكم مع التوصيل للسالمية؟\nأبي كوفي"
  );
  const [qualityResult, setQualityResult] = useState<QualityEvalResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  const [templateTopic, setTemplateTopic] = useState("");
  const [templateDraft, setTemplateDraft] = useState<AiTemplateDraft | null>(null);
  const [templateHeaderFile, setTemplateHeaderFile] = useState<UploadedFile | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [templateAlts, setTemplateAlts] = useState<AiTemplateDraft[]>([]);

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });
  const waList = whatsappAccounts.data ?? [];
  const selectedWa = useMemo(
    () => waList.find((item) => item.channel_id === channelId) ?? null,
    [waList, channelId]
  );

  useEffect(() => {
    if (!waList.length) return;
    setChannelId((current) => current || searchParams.get("channel_id") || waList[0]?.channel_id || "");
  }, [waList, searchParams]);

  const settingsQuery = useQuery({
    queryKey: ["knowledge-agent-settings", channelId || "account"],
    enabled: Boolean(channelId),
    queryFn: async () => {
      const suffix = channelId ? `?channel_id=${encodeURIComponent(channelId)}` : "";
      return (await api.get<EffectiveSettings>(`/knowledge/agent-settings${suffix}`)).data;
    }
  });
  const settings = settingsQuery.data;
  const replyMode = settings?.reply_mode;
  const replyChoice = selectedReplyChoice(settings);

  const activityQuery = useQuery({
    queryKey: ["ai-activity", channelId],
    enabled: Boolean(channelId) && tab === "activity",
    queryFn: async () =>
      (
        await api.get<ActivityRow[]>(
          `/knowledge/ai/activity?channel_id=${encodeURIComponent(channelId)}&limit=40`
        )
      ).data
  });

  const draftsQuery = useQuery({
    queryKey: ["ai-template-drafts", channelId],
    enabled: Boolean(channelId) && tab === "templates",
    queryFn: async () =>
      (
        await api.get<SavedDraft[]>(
          `/knowledge/ai/template-drafts?channel_id=${encodeURIComponent(channelId)}`
        )
      ).data
  });

  const subscriptionQuery = useQuery({
    queryKey: ["subscription"],
    enabled: tab === "settings",
    queryFn: async () => {
      try {
        return (await api.get<SubscriptionInfo>("/billing/subscription")).data;
      } catch {
        return null;
      }
    }
  });

  useEffect(() => {
    if (!settings || hoursDirty) return;
    setHoursDraft(normalizeBusinessHours(settings.business_hours_json));
  }, [settings, hoursDirty]);

  async function saveSettings(patch: AgentSettingsPatch & Record<string, unknown>) {
    if (!channelId && !("agent_enabled" in patch && Object.keys(patch).length === 1)) {
      toastStore.getState().show("اختر قناة واتساب أولاً لتعديل إعداداتها.", "error");
      return false;
    }
    try {
      const isKillOnly = Object.keys(patch).length === 1 && "agent_enabled" in patch && !channelId;
      const suffix =
        channelId && !isKillOnly ? `?channel_id=${encodeURIComponent(channelId)}` : "";
      await api.patch(`/knowledge/agent-settings${suffix}`, patch);
      await client.invalidateQueries({ queryKey: ["knowledge-agent-settings"] });
      toastStore.getState().show("تم حفظ إعدادات القناة.", "success");
      return true;
    } catch {
      toastStore.getState().show("تعذر حفظ الإعدادات.", "error");
      return false;
    }
  }

  async function toggleAccountKill() {
    const next = !(settings?.account_agent_enabled !== false);
    try {
      await api.patch("/knowledge/agent-settings", { agent_enabled: next });
      await client.invalidateQueries({ queryKey: ["knowledge-agent-settings"] });
      toastStore.getState().show(next ? "تم تشغيل الذكاء للحساب." : "تم إيقاف الذكاء لجميع القنوات.", "success");
    } catch {
      toastStore.getState().show("تعذر تغيير مفتاح الطوارئ.", "error");
    }
  }

  async function saveBusinessHours() {
    if (!hoursDraft) return;
    const ok = await saveSettings({ business_hours_json: hoursDraft });
    if (ok) setHoursDirty(false);
  }

  function updateHoursDay(day: string, patch: { open?: boolean; start?: string; end?: string }) {
    setHoursDraft((current) => {
      const base = current ?? normalizeBusinessHours(settings?.business_hours_json);
      const existing = base.days[day];
      const open = patch.open ?? existing != null;
      const nextSlot = open
        ? ([patch.start ?? existing?.[0] ?? "09:00", patch.end ?? existing?.[1] ?? "18:00"] as [string, string])
        : null;
      setHoursDirty(true);
      return { ...base, days: { ...base.days, [day]: nextSlot } };
    });
  }

  async function saveLlmApiKey() {
    if (!llmApiKeyDraft.trim()) return;
    const ok = await saveSettings({ llm_api_key: llmApiKeyDraft.trim() });
    if (ok) setLlmApiKeyDraft("");
  }

  async function applyReplyChoice(choice: ReplyChoice) {
    if (!settings) return;
    if (settings.account_agent_enabled === false) {
      toastStore.getState().show("شغّل الذكاء للحساب أولاً من زر الطوارئ.", "error");
      return;
    }
    if (choice === "staff") {
      await saveSettings({
        agent_enabled: true,
        local_engine_enabled: settings.local_engine_enabled !== false,
        auto_kb_on_inbound: false,
        auto_reply_on_inbound: false
      });
      return;
    }
    if (choice === "suggest") {
      await saveSettings({
        agent_enabled: true,
        local_engine_enabled: true,
        auto_kb_on_inbound: true,
        auto_reply_on_inbound: false
      });
      return;
    }
    await saveSettings({
      agent_enabled: true,
      local_engine_enabled: true,
      auto_kb_on_inbound: true,
      auto_reply_on_inbound: true
    });
  }

  async function runLabTurn(text?: string) {
    const query = (text ?? labInput).trim();
    if (!query || !channelId) return;
    setLabBusy(true);
    setLabTurns((current) => [...current, { role: "customer", text: query }]);
    setLabInput("");
    try {
      const result = await api.post<{
        customer_reply?: string;
        reason_text?: string;
        understood?: Record<string, unknown>;
        dialogue?: Record<string, unknown>;
        whatsapp_sent?: boolean;
        order_created?: boolean;
      }>("/knowledge/ai/lab-turn", {
        channel_id: channelId,
        query,
        contact_name: labContactName,
        dialogue_state: labDialogue,
        dry_run: true
      });
      const reply = result.data.customer_reply || "—";
      setLabTurns((current) => [
        ...current,
        {
          role: "assistant",
          text: reply,
          meta: {
            reason: result.data.reason_text,
            understood: result.data.understood,
            dry_run: true,
            whatsapp_sent: result.data.whatsapp_sent,
            order_created: result.data.order_created
          }
        }
      ]);
      setLabDialogue(result.data.dialogue ?? null);
      setLastUnderstood(result.data.understood ?? null);
      setLastReason(result.data.reason_text || "");
    } catch {
      toastStore.getState().show("تعذر تشغيل المختبر.", "error");
    } finally {
      setLabBusy(false);
    }
  }

  function resetLab() {
    setLabTurns([]);
    setLabDialogue(null);
    setLastUnderstood(null);
    setLastReason("");
  }

  useEffect(() => {
    const seed = searchParams.get("q")?.trim();
    if (!seed || !channelId || labAutostartDone || searchParams.get("lab") !== "1") return;
    setLabAutostartDone(true);
    setTab("lab");
    void runLabTurn(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, searchParams, labAutostartDone]);

  async function runQualityLab() {
    const cases = qualityCasesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((query) => ({ query }));
    if (!cases.length) return;
    setQualityLoading(true);
    try {
      const result = await evaluateKnowledgeQuality(cases);
      setQualityResult(result.data);
    } catch {
      toastStore.getState().show("تعذر تشغيل مختبر الجودة.", "error");
    } finally {
      setQualityLoading(false);
    }
  }

  async function generateTemplate(angle?: string) {
    if (!templateTopic.trim()) {
      toastStore.getState().show("اكتب موضوع القالب.", "error");
      return;
    }
    setTemplateBusy(true);
    try {
      const result = await api.post<AiTemplateDraft>("/templates/ai/generate", {
        topic: angle ? `${templateTopic.trim()} — زاوية: ${angle}` : templateTopic.trim(),
        language: "ar",
        category: "marketing",
        brand_hint: selectedWa?.verified_name || selectedWa?.channel_name || null
      });
      setTemplateDraft(result.data);
      setTemplateHeaderFile(null);
      setNewDraftOpen(true);
    } catch {
      toastStore.getState().show("تعذر توليد القالب. تأكد من المزود الخارجي.", "error");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function generateHeaderImage() {
    if (!templateDraft) return;
    const prompt =
      (templateDraft.image_prompt || "").trim() ||
      `WhatsApp template header image for: ${templateDraft.name}. ${templateDraft.body_text.slice(0, 180)}`;
    setImageBusy(true);
    try {
      const result = await api.post<UploadedFile & { prompt?: string }>("/templates/ai/image", {
        prompt
      });
      setTemplateHeaderFile({
        id: result.data.id,
        filename: result.data.filename,
        content_type: result.data.content_type,
        size_bytes: result.data.size_bytes,
        object_key: result.data.object_key,
        public_url: result.data.public_url
      });
      setTemplateDraft((current) =>
        current
          ? {
              ...current,
              header_type: "IMAGE",
              image_prompt: prompt
            }
          : current
      );
      toastStore.getState().show("تم توليد صورة الرأس وحفظها.", "success");
    } catch (err) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : "";
      if (detail.includes("LLM_NOT_CONFIGURED")) {
        toastStore.getState().show("فعّل المزود الخارجي ومفتاح API أولاً لتوليد الصور.", "error");
      } else if (detail.startsWith("IMAGE_FAILED:")) {
        toastStore.getState().show("تعذر توليد الصورة من المزود. جرّب نموذجاً آخر أو مفتاحاً يدعم الصور.", "error");
      } else {
        toastStore.getState().show("تعذر توليد صورة الرأس.", "error");
      }
    } finally {
      setImageBusy(false);
    }
  }

  async function generateThreeAngles() {
    if (!templateTopic.trim()) return;
    setTemplateBusy(true);
    try {
      const angles = ["عرض سعر", "ندرة / كمية محدودة", "فائدة المنتج"];
      const drafts: AiTemplateDraft[] = [];
      for (const angle of angles) {
        const result = await api.post<AiTemplateDraft>("/templates/ai/generate", {
          topic: `${templateTopic.trim()} — زاوية: ${angle}`,
          language: "ar",
          category: "marketing",
          brand_hint: selectedWa?.verified_name || null
        });
        drafts.push(result.data);
        await api.post("/knowledge/ai/template-drafts", {
          channel_id: channelId,
          whatsapp_account_id: selectedWa?.id,
          topic: templateTopic.trim(),
          angle,
          draft: result.data,
          status: "draft"
        });
      }
      setTemplateAlts(drafts);
      setTemplateDraft(drafts[0] ?? null);
      setNewDraftOpen(true);
      await client.invalidateQueries({ queryKey: ["ai-template-drafts", channelId] });
      toastStore.getState().show("تم توليد 3 بدائل وحفظها كمسودات للقناة.", "success");
    } catch {
      toastStore.getState().show("تعذر توليد البدائل.", "error");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function saveCurrentDraft(status = "draft") {
    if (!templateDraft || !channelId) return;
    try {
      await api.post("/knowledge/ai/template-drafts", {
        channel_id: channelId,
        whatsapp_account_id: selectedWa?.id,
        topic: templateTopic.trim() || templateDraft.name,
        draft: templateDraft,
        status
      });
      await client.invalidateQueries({ queryKey: ["ai-template-drafts", channelId] });
      toastStore.getState().show(status === "rejected" ? "تم رفض المسودة." : "تم حفظ المسودة.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ المسودة.", "error");
    }
  }

  async function approveDraftToMeta() {
    if (!templateDraft || !selectedWa) return;
    const headerType =
      templateDraft.header_type === "IMAGE"
        ? ("IMAGE" as TemplateHeaderFormat)
        : templateDraft.header_type === "TEXT"
          ? ("TEXT" as TemplateHeaderFormat)
          : null;
    const components = buildStoredComponents(templateDraft.body_text, templateHeaderFile, headerType, {
      category: templateDraft.category,
      includeMarketingOptOut: templateDraft.category === "marketing",
      headerText: templateDraft.header_text,
      footerText: templateDraft.footer_text,
      customButtons: templateDraft.buttons ?? [],
      bodySamples: templateDraft.body_samples ?? []
    });
    try {
      const created = await api.post<{ id: string; status: string }>("/templates", {
        whatsapp_account_id: selectedWa.id,
        name: templateDraft.name,
        language: templateDraft.language || "ar",
        category: templateDraft.category || "marketing",
        body_text: templateDraft.body_text,
        components,
        submit_to_meta: true
      });
      await saveCurrentDraft("submitted");
      toastStore.getState().show(
        created.data.status === "pending" ? "تم الترحيل إلى ميتا للمراجعة." : "تم حفظ القالب.",
        "success"
      );
    } catch {
      toastStore.getState().show("تعذر الترحيل إلى ميتا.", "error");
    }
  }

  const previewComponents = useMemo(() => {
    if (!templateDraft) return [];
    const headerType =
      templateDraft.header_type === "IMAGE"
        ? ("IMAGE" as TemplateHeaderFormat)
        : templateDraft.header_type === "TEXT"
          ? ("TEXT" as TemplateHeaderFormat)
          : null;
    return buildStoredComponents(templateDraft.body_text, templateHeaderFile, headerType, {
      category: templateDraft.category,
      includeMarketingOptOut: templateDraft.category === "marketing",
      headerText: templateDraft.header_text,
      footerText: templateDraft.footer_text,
      customButtons: templateDraft.buttons ?? [],
      bodySamples: templateDraft.body_samples ?? []
    });
  }, [templateDraft, templateHeaderFile]);

  const agentOn = settings?.agent_enabled !== false && settings?.account_agent_enabled !== false;
  const localOn = agentOn && settings?.local_engine_enabled !== false;
  const llmOn = agentOn && Boolean(settings?.llm_enabled && settings?.llm_available);
  const interpretation = extractInterpretation(lastUnderstood, labDialogue);
  const filteredActivity = useMemo(() => {
    const rows = activityQuery.data ?? [];
    if (activityRange === "all") return rows;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rows.filter((row) => {
      if (!row.created_at) return true;
      const ts = new Date(row.created_at).getTime();
      return Number.isNaN(ts) || ts >= cutoff;
    });
  }, [activityQuery.data, activityRange]);

  const statusCopy =
    replyChoice === "suggest"
      ? {
          title: "يقترح للموظف",
          body: "يوفر رداً جاهزاً للموظف ليراجعه قبل الإرسال."
        }
      : replyChoice === "auto"
        ? {
            title: "يرد تلقائياً",
            body: "يرسل الرد للعميل مباشرة عبر واتساب عند الرسائل الواردة."
          }
        : {
            title: "الموظف يرد",
            body: "المساعد لا يقترح ولا يرسل — الموظف يتولى المحادثة."
          };

  const outsideHoursOn = Boolean(settings?.auto_reply_outside_hours);
  const welcomeOn = Boolean(settings?.welcome_message_enabled);
  const subscription = subscriptionQuery.data;
  const formatSubDate = (value?: string | null) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("ar-KW", { year: "numeric", month: "short", day: "numeric" });
  };

  return (
    <main className="page ai-ops-page">
      <div className="ai-ops-shell">
        <header className="ai-ops-top">
          <div className="ai-ops-title-row">
            <h1>الذكاء الاصطناعي</h1>
            <div className="ai-channel-chip" aria-label="اختيار القناة">
              <strong className="ai-channel-label">قناة</strong>
              <label className="ai-channel-card">
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  {!waList.length && <option value="">لا توجد قنوات</option>}
                  {waList.map((wa) => (
                    <option key={wa.id} value={wa.channel_id}>
                      {wa.channel_name || wa.verified_name || channelTitle(wa)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <nav className="ai-underline-tabs" aria-label="أقسام الذكاء">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "is-active" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

      {tab === "ops" && settings && (
        <>
          <section className="ai-panel">
            <article className={`ai-status-card ${modeClass(replyMode?.mode)}`}>
              <div className="ai-status-main">
                <span className="ai-status-dot" aria-hidden />
                <div>
                  <h2>{statusCopy.title}</h2>
                  <p>{statusCopy.body}</p>
                  {(replyMode?.blockers ?? []).map((item) => (
                    <p key={item.code} className="ai-status-note">
                      {item.text}
                    </p>
                  ))}
                </div>
              </div>
              <div className="ai-status-actions">
                <button
                  type="button"
                  className={`agent-state-toggle ${agentOn ? "is-on" : "is-off"}`}
                  disabled={settings.account_agent_enabled === false}
                  title="تفعيل أو إيقاف الذكاء لهذه القناة"
                  onClick={() => void saveSettings({ agent_enabled: !settings.agent_enabled })}
                >
                  {agentOn ? "الذكاء يعمل" : "الذكاء متوقف"}
                </button>
                <button
                  type="button"
                  className="whatsapp-button ai-status-cta"
                  onClick={() => {
                    setTab("lab");
                    resetLab();
                  }}
                >
                  جرّب محادثة
                </button>
              </div>
            </article>

            <div className="ai-section">
              <h3>وضع الرد</h3>
              <div className="ai-mode-radios" role="radiogroup" aria-label="وضع الرد">
                {REPLY_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    aria-checked={replyChoice === choice.id}
                    className={`ai-mode-radio ${replyChoice === choice.id ? "is-active" : ""}`}
                    onClick={() => void applyReplyChoice(choice.id)}
                  >
                    <span className="ai-radio-mark" aria-hidden />
                    <span className="ai-mode-radio-copy">
                      <strong>{choice.title}</strong>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="ai-section">
              <h3>مصادر الرد</h3>
              <div className="ai-source-toggles">
                <div className="ai-toggle-row">
                  <div>
                    <strong>رسالة ترحيب لأول رسالة</strong>
                    <p>شكر للتواصل وإخبار العميل كيف نساعده — تُرسل مرة واحدة فقط.</p>
                  </div>
                  <button
                    type="button"
                    className={`agent-state-toggle ${welcomeOn ? "is-on" : "is-off"}`}
                    disabled={!agentOn}
                    onClick={() =>
                      void saveSettings({ welcome_message_enabled: !settings.welcome_message_enabled })
                    }
                  >
                    {welcomeOn ? "مفعّل" : "متوقف"}
                  </button>
                </div>
                {welcomeOn && (
                  <label className="field-label">
                    <span>نص الترحيب</span>
                    <textarea
                      rows={3}
                      defaultValue={settings.welcome_message || DEFAULT_WELCOME}
                      onBlur={(e) =>
                        void saveSettings({ welcome_message: e.target.value.trim() || DEFAULT_WELCOME })
                      }
                    />
                  </label>
                )}

                <div className="ai-toggle-row">
                  <div>
                    <strong>تفعيل أوقات خارج الدوام</strong>
                    <p>رد تلقائي أو رسالة خارج ساعات العمل عند التفعيل.</p>
                  </div>
                  <button
                    type="button"
                    className={`agent-state-toggle ${outsideHoursOn ? "is-on" : "is-off"}`}
                    disabled={!agentOn}
                    onClick={() =>
                      void saveSettings({ auto_reply_outside_hours: !settings.auto_reply_outside_hours })
                    }
                  >
                    {outsideHoursOn ? "مفعّل" : "متوقف"}
                  </button>
                </div>
                {outsideHoursOn && (
                  <label className="field-label">
                    <span>رسالة خارج الدوام</span>
                    <textarea
                      rows={2}
                      defaultValue={
                        settings.outside_hours_message ||
                        "شكراً لتواصلك. نحن خارج ساعات العمل حالياً وسنرد عليك في أقرب وقت."
                      }
                      onBlur={(e) =>
                        void saveSettings({ outside_hours_message: e.target.value.trim() || null })
                      }
                    />
                  </label>
                )}
              </div>

              {outsideHoursOn && (
                <div className="ai-hours-card">
                  <div className="ai-hours-card-head">
                    <h4>لائحة الدوام</h4>
                    <button
                      type="button"
                      className="whatsapp-button"
                      disabled={!hoursDirty}
                      onClick={() => void saveBusinessHours()}
                    >
                      حفظ الساعات
                    </button>
                  </div>
                  <div className="agent-hours-table">
                    {DAY_ORDER.map((day) => {
                      const slot = hoursDraft?.days[day] ?? null;
                      const open = slot != null;
                      return (
                        <div key={day} className="agent-hours-row">
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={open}
                              disabled={!agentOn}
                              onChange={(e) => updateHoursDay(day, { open: e.target.checked })}
                            />
                            <span>{DAY_LABELS[day]}</span>
                          </label>
                          <input
                            type="time"
                            value={slot?.[0] ?? "09:00"}
                            disabled={!open || !agentOn}
                            onChange={(e) => updateHoursDay(day, { start: e.target.value })}
                          />
                          <span className="hint-text">إلى</span>
                          <input
                            type="time"
                            value={slot?.[1] ?? "18:00"}
                            disabled={!open || !agentOn}
                            onChange={(e) => updateHoursDay(day, { end: e.target.value })}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {replyChoice !== "staff" && (
                <>
                  <h3 className="ai-subsection-title">مصادر المعرفة</h3>
                  <div className="ai-accordion">
                    <Link className="ai-accordion-row" to="/knowledge">
                      <span className="ai-accordion-icon is-book" aria-hidden />
                      <span className="ai-accordion-label">المعرفة</span>
                      <span className="ai-accordion-meta">{localOn ? "مفعّل" : "متوقف"}</span>
                      <span className="ai-accordion-chevron" aria-hidden />
                    </Link>
                    <Link className="ai-accordion-row" to="/catalog">
                      <span className="ai-accordion-icon is-box" aria-hidden />
                      <span className="ai-accordion-label">الكتالوج</span>
                      <span className="ai-accordion-meta">{localOn ? "مفعّل" : "متوقف"}</span>
                      <span className="ai-accordion-chevron" aria-hidden />
                    </Link>
                  </div>
                </>
              )}
            </div>
          </section>

        </>
      )}

      {tab === "lab" && (
        <section className="ai-panel">
          <div className="ai-panel-head">
            <h2>التجربة</h2>
            <button type="button" className="secondary-button" onClick={resetLab}>
              اختبار داخلي
            </button>
          </div>

          <div className="ai-lab-layout">
            <div className="ai-lab-chat-pane">
              <div className="ai-lab-thread">
                {labTurns.length === 0 && (
                  <p className="hint-text">مثال: أبي حبتين rose soap — ثم خلّهم ثلاث</p>
                )}
                {labTurns.map((turn, index) => (
                  <article key={`${turn.role}-${index}`} className={`ai-lab-bubble is-${turn.role}`}>
                    {turn.role === "assistant" ? (
                      <WhatsAppTextPreview text={turn.text} compact />
                    ) : (
                      <p>{turn.text}</p>
                    )}
                  </article>
                ))}
              </div>
              <form
                className="ai-lab-composer"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void runLabTurn();
                }}
              >
                <input
                  value={labInput}
                  onChange={(e) => setLabInput(e.target.value)}
                  placeholder="اكتب رسالة العميل…"
                  disabled={labBusy}
                />
                <button type="submit" className="whatsapp-button" disabled={labBusy || !labInput.trim()}>
                  {labBusy ? "…" : "إرسال"}
                </button>
              </form>
            </div>

            <aside className="ai-interpret-card">
              <h3>تفسير الطلب</h3>
              <dl className="ai-interpret-grid">
                <div>
                  <dt>المنتج</dt>
                  <dd>{interpretation.productName}</dd>
                </div>
                <div>
                  <dt>الكمية</dt>
                  <dd>{interpretation.quantity ?? "—"}</dd>
                </div>
                <div>
                  <dt>الوزن</dt>
                  <dd>{interpretation.weight ?? "—"}</dd>
                </div>
              </dl>
              {lastReason && <p className="ai-interpret-note">{lastReason}</p>}
            </aside>
          </div>

          <details className="ai-quality-details">
            <summary>مختبر جودة سريع</summary>
            <label className="field-label">
              <span>اسم العميل</span>
              <input value={labContactName} onChange={(e) => setLabContactName(e.target.value)} />
            </label>
            <textarea rows={4} value={qualityCasesText} onChange={(e) => setQualityCasesText(e.target.value)} />
            <button
              type="button"
              className="secondary-button"
              onClick={() => void runQualityLab()}
              disabled={qualityLoading}
            >
              {qualityLoading ? "جاري القياس…" : "تشغيل الحالات"}
            </button>
            {qualityResult && (
              <p className="hint-text">
                الإصابة: {qualityResult.hits}/{qualityResult.total} (
                {Math.min(100, Math.round(qualityResult.hit_rate * 100))}%)
              </p>
            )}
          </details>
        </section>
      )}

      {tab === "templates" && (
        <section className="ai-panel">
          <div className="ai-panel-head">
            <h2>القوالب</h2>
            <button
              type="button"
              className="whatsapp-button"
              disabled={!agentOn}
              onClick={() => {
                setNewDraftOpen(true);
                setTemplateDraft(null);
                setTemplateHeaderFile(null);
                setTemplateTopic("");
              }}
            >
              + مسودة جديدة
            </button>
          </div>

          <p className={`ai-templates-note ${agentOn ? "is-ready" : "is-blocked"}`}>
            {agentOn
              ? "القوالب تعمل لأن الذكاء الاصطناعي مفعّل على هذه القناة."
              : "ملاحظة: توليد القوالب يعمل فقط عند تفعيل الذكاء الاصطناعي لهذه القناة."}
          </p>

          <div className="ai-template-list">
            {(draftsQuery.data ?? []).map((item) => {
              const status = draftStatusMeta(item);
              return (
                <article key={item.id} className="ai-template-row">
                  <strong>{item.topic || item.draft?.name || "مسودة"}</strong>
                  <span className={`ai-status-badge ${status.className}`}>{status.label}</span>
                  <button
                    type="button"
                    className="ai-icon-button"
                    aria-label="فتح المسودة"
                    onClick={() => {
                      setTemplateDraft(item.draft);
                      setTemplateTopic(item.topic || item.draft?.name || "");
                      setTemplateHeaderFile(null);
                      setNewDraftOpen(true);
                    }}
                  >
                    ⋯
                  </button>
                </article>
              );
            })}
            {!draftsQuery.data?.length && (
              <p className="hint-text">لا مسودات بعد لهذه القناة. ابدأ بمسودة جديدة.</p>
            )}
          </div>

          {newDraftOpen && (
            <div className="ai-template-editor">
              <label className="field-label">
                <span>موضوع القالب</span>
                <textarea rows={2} value={templateTopic} onChange={(e) => setTemplateTopic(e.target.value)} />
              </label>
              <div className="catalog-card-actions">
                <button
                  type="button"
                  className="whatsapp-button"
                  disabled={templateBusy || !agentOn}
                  onClick={() => void generateTemplate()}
                >
                  توليد مسودة
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={templateBusy || !agentOn}
                  onClick={() => void generateThreeAngles()}
                >
                  توليد 3 بدائل
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!templateDraft}
                  onClick={() => void saveCurrentDraft("draft")}
                >
                  حفظ مسودة
                </button>
                <button
                  type="button"
                  className="whatsapp-button"
                  disabled={!templateDraft}
                  onClick={() => void approveDraftToMeta()}
                >
                  اعتماد وترحيل ميتا
                </button>
              </div>

              {templateDraft && (
                <div className="agent-section-grid" style={{ marginTop: 12 }}>
                  <div className="agent-section-card accent-create stack-form">
                    <label className="field-label">
                      <span>الاسم</span>
                      <input
                        value={templateDraft.name}
                        onChange={(e) => setTemplateDraft((c) => (c ? { ...c, name: e.target.value } : c))}
                        dir="ltr"
                      />
                    </label>
                    <label className="field-label">
                      <span>النص</span>
                      <textarea
                        rows={5}
                        value={templateDraft.body_text}
                        onChange={(e) =>
                          setTemplateDraft((c) => (c ? { ...c, body_text: e.target.value } : c))
                        }
                      />
                    </label>
                    <label className="field-label">
                      <span>وصف صورة الرأس</span>
                      <textarea
                        rows={3}
                        value={templateDraft.image_prompt}
                        onChange={(e) =>
                          setTemplateDraft((c) => (c ? { ...c, image_prompt: e.target.value } : c))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="whatsapp-button"
                      disabled={imageBusy || templateBusy || !agentOn}
                      onClick={() => void generateHeaderImage()}
                    >
                      {imageBusy ? "جاري توليد الصورة…" : "توليد صورة الرأس"}
                    </button>
                    {templateHeaderFile && <p className="hint-text">✓ {templateHeaderFile.filename}</p>}
                  </div>
                  <div className="agent-section-card accent-import">
                    <WhatsAppTemplatePreview
                      businessName={selectedWa?.verified_name || "نشاطك"}
                      bodyText={templateDraft.body_text}
                      components={previewComponents}
                    />
                  </div>
                </div>
              )}

              {templateAlts.length > 0 && (
                <div className="knowledge-matched-list" style={{ marginTop: 12 }}>
                  {templateAlts.map((item) => (
                    <article key={item.name} className="inbox-kb-card">
                      <strong>{item.name}</strong>
                      <p className="hint-text">{item.body_text.slice(0, 120)}…</p>
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setTemplateDraft(item)}
                      >
                        استخدام
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "settings" && settings && (
        <section className="ai-panel">
          <div className="ai-panel-head">
            <h2>إعدادات الربط بالمزود</h2>
            <button
              type="button"
              className="ai-emergency-btn"
              onClick={() => void toggleAccountKill()}
              title="إيقاف كل مزودات الذكاء الاصطناعي في جميع القنوات"
            >
              {settings.account_agent_enabled === false
                ? "طوارئ: إعادة تشغيل كل المزودات"
                : "طوارئ: إغلاق كل مزودات الذكاء"}
            </button>
          </div>

          <div className="ai-settings-split">
            <div className="ai-settings-split-main">
              <h3>المزودات المضافة</h3>
              <div className="ai-provider-table" role="table" aria-label="مزودات الذكاء">
                <div className="ai-provider-head" role="row">
                  <span role="columnheader">المزود</span>
                  <span role="columnheader">الحالة</span>
                  <span role="columnheader">زمن الاشتراك</span>
                  <span role="columnheader">المبلغ</span>
                  <span role="columnheader">الرصيد / المساحة</span>
                  <span role="columnheader">إعدادات</span>
                  <span role="columnheader">إجراء</span>
                  <span role="columnheader">إلغاء</span>
                </div>

                <div className="ai-provider-row" role="row">
                  <span role="cell">
                    <strong>المحرك الداخلي</strong>
                    <small>معرفة + كتالوج</small>
                  </span>
                  <span role="cell">{localOn ? "يعمل" : "متوقف"}</span>
                  <span role="cell">
                    {formatSubDate(subscription?.starts_at)} → {formatSubDate(subscription?.ends_at)}
                  </span>
                  <span role="cell">
                    {subscription?.plan_name
                      ? `${subscription.plan_name}${subscription.billing_cycle ? ` · ${subscription.billing_cycle}` : ""}`
                      : "ضمن الباقة"}
                  </span>
                  <span role="cell">
                    {subscription?.mac_remaining != null
                      ? `${subscription.mac_remaining} متبقي من ${subscription.included_mac ?? "—"} محادثة`
                      : "—"}
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className={`ai-provider-btn is-settings ${providerPanel === "local" ? "is-open" : ""}`}
                      onClick={() => setProviderPanel((v) => (v === "local" ? null : "local"))}
                    >
                      إعدادات
                    </button>
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className={`ai-provider-btn ${localOn ? "is-on" : "is-off"}`}
                      disabled={settings.account_agent_enabled === false || !settings.agent_enabled}
                      onClick={() =>
                        void saveSettings({ local_engine_enabled: settings.local_engine_enabled === false })
                      }
                    >
                      <strong>{localOn ? "إيقاف" : "تشغيل"}</strong>
                      <span>هذه القناة</span>
                    </button>
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className="ai-provider-btn is-remove"
                      disabled={!localOn && settings.local_engine_enabled === false}
                      onClick={() => void saveSettings({ local_engine_enabled: false })}
                    >
                      إلغاء المزود
                    </button>
                  </span>
                </div>

                {providerPanel === "local" && (
                  <div className="ai-provider-drawer" role="row">
                    <div className="ai-provider-drawer-inner" role="cell">
                      <div className="ai-panel-head" style={{ margin: "0 0 12px", paddingBottom: 10 }}>
                        <h2>إعدادات المحرك الداخلي</h2>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setProviderPanel(null)}
                        >
                          إغلاق
                        </button>
                      </div>
                      <div className="ai-advanced-stack">
                        <div className="knowledge-fields-row">
                          <label className="field-label">
                            <span>المحرك الداخلي</span>
                            <button
                              type="button"
                              className={`agent-state-toggle ${localOn ? "is-on" : "is-off"}`}
                              disabled={!agentOn}
                              onClick={() =>
                                void saveSettings({
                                  local_engine_enabled: settings.local_engine_enabled === false
                                })
                              }
                            >
                              {localOn ? "يعمل" : "متوقف"}
                            </button>
                          </label>
                          <label className="field-label">
                            <span>وضع المحرك</span>
                            <select
                              value={settings.default_mode}
                              disabled={!agentOn || !localOn}
                              onChange={(e) =>
                                void saveSettings({
                                  default_mode: e.target.value as AgentSettings["default_mode"]
                                })
                              }
                            >
                              {Object.entries(MODE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field-label">
                            <span>النبرة</span>
                            <select
                              value={settings.tone}
                              onChange={(e) =>
                                void saveSettings({ tone: e.target.value as AgentSettings["tone"] })
                              }
                            >
                              <option value="friendly">ودّية</option>
                              <option value="formal">رسمية</option>
                              <option value="concise">مختصرة</option>
                            </select>
                          </label>
                          <label className="field-label">
                            <span>حد جولات التوضيح</span>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              defaultValue={settings.clarify_max_rounds ?? 2}
                              onBlur={(e) =>
                                void saveSettings({ clarify_max_rounds: Number(e.target.value) || 2 })
                              }
                            />
                          </label>
                        </div>
                        <label className="field-label">
                          <span>كلمات التصعيد</span>
                          <textarea
                            rows={3}
                            defaultValue={(settings.escalation_keywords ?? []).join("\n")}
                            placeholder={"شكوى\nمحامي\nاسترجاع فلوسي\nمدير"}
                            onBlur={(e) => {
                              const keywords = e.target.value
                                .split(/[\n,،]+/)
                                .map((item) => item.trim())
                                .filter(Boolean);
                              void saveSettings({ escalation_keywords: keywords });
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="ai-provider-row" role="row">
                  <span role="cell">
                    <strong>المزود الخارجي</strong>
                    <small>{settings.llm_model || "gpt-4o-mini"}</small>
                  </span>
                  <span role="cell">{llmStatusLabel(settings)}</span>
                  <span role="cell">{subscription?.cycle_month || "—"}</span>
                  <span role="cell">
                    {subscription?.over_mac_price_per_100 != null
                      ? `${subscription.over_mac_price_per_100} / 100 محادثة إضافية`
                      : "حسب مزود API"}
                  </span>
                  <span role="cell">
                    {settings.llm_key_configured ? "مفتاح مربوط" : "بدون مفتاح"}
                    {subscription?.estimated_over_mac_charge
                      ? ` · تقدير زيادة ${subscription.estimated_over_mac_charge}`
                      : ""}
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className={`ai-provider-btn is-settings ${providerPanel === "external" ? "is-open" : ""}`}
                      onClick={() => setProviderPanel((v) => (v === "external" ? null : "external"))}
                    >
                      إعدادات
                    </button>
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className={`ai-provider-btn ${llmOn ? "is-on" : "is-off"}`}
                      disabled={!settings.llm_available || !agentOn}
                      onClick={() => void saveSettings({ llm_enabled: !settings.llm_enabled })}
                    >
                      <strong>{llmOn ? "إيقاف" : "تشغيل"}</strong>
                      <span>هذه القناة</span>
                    </button>
                  </span>
                  <span role="cell">
                    <button
                      type="button"
                      className="ai-provider-btn is-remove"
                      disabled={!settings.llm_key_configured && !settings.llm_enabled}
                      onClick={() =>
                        void saveSettings({
                          llm_enabled: false,
                          clear_llm_api_key: true,
                          llm_api_base_url: null,
                          llm_model: null,
                          llm_image_model: null
                        })
                      }
                    >
                      إلغاء المزود
                    </button>
                  </span>
                </div>

                {providerPanel === "external" && (
                  <div className="ai-provider-drawer" role="row">
                    <div className="ai-provider-drawer-inner" role="cell">
                      <div className="ai-panel-head" style={{ margin: "0 0 12px", paddingBottom: 10 }}>
                        <h2>تفاصيل ربط المزود الخارجي</h2>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setProviderPanel(null)}
                        >
                          إغلاق
                        </button>
                      </div>
                      <div className="knowledge-fields-row">
                        <label className="field-label">
                          <span>مفتاح API</span>
                          <input
                            type="password"
                            value={llmApiKeyDraft}
                            onChange={(e) => setLlmApiKeyDraft(e.target.value)}
                            dir="ltr"
                          />
                        </label>
                        <label className="field-label">
                          <span>Base URL</span>
                          <input
                            defaultValue={settings.llm_api_base_url ?? ""}
                            onBlur={(e) =>
                              void saveSettings({ llm_api_base_url: e.target.value.trim() || null })
                            }
                            dir="ltr"
                          />
                        </label>
                        <label className="field-label">
                          <span>نموذج الرد</span>
                          <input
                            defaultValue={settings.llm_model ?? ""}
                            onBlur={(e) => void saveSettings({ llm_model: e.target.value.trim() || null })}
                            dir="ltr"
                          />
                        </label>
                        <label className="field-label">
                          <span>نموذج الصور</span>
                          <input
                            defaultValue={settings.llm_image_model ?? ""}
                            placeholder="gpt-image-1 ثم dall-e-3 تلقائياً"
                            onBlur={(e) =>
                              void saveSettings({ llm_image_model: e.target.value.trim() || null })
                            }
                            dir="ltr"
                          />
                        </label>
                      </div>
                      <div className="catalog-card-actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="whatsapp-button"
                          onClick={() => void saveLlmApiKey()}
                          disabled={!llmApiKeyDraft.trim()}
                        >
                          حفظ المفتاح
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <aside className="ai-add-provider-card">
              <h3>إضافة مزود جديد</h3>
              <p>اربط مزوداً خارجياً متوافقاً مع OpenAI. بعد الحفظ يظهر في جدول المزودات المضافة.</p>
              <label className="field-label">
                <span>مفتاح API</span>
                <input
                  type="password"
                  value={llmApiKeyDraft}
                  onChange={(e) => setLlmApiKeyDraft(e.target.value)}
                  placeholder="sk-..."
                  dir="ltr"
                />
              </label>
              <label className="field-label">
                <span>Base URL</span>
                <input
                  defaultValue={settings.llm_api_base_url ?? ""}
                  placeholder="https://api.openai.com/v1"
                  onBlur={(e) => void saveSettings({ llm_api_base_url: e.target.value.trim() || null })}
                  dir="ltr"
                />
              </label>
              <label className="field-label">
                <span>نموذج الرد</span>
                <input
                  defaultValue={settings.llm_model ?? ""}
                  placeholder="gpt-4o-mini"
                  onBlur={(e) => void saveSettings({ llm_model: e.target.value.trim() || null })}
                  dir="ltr"
                />
              </label>
              <label className="field-label">
                <span>نموذج الصور</span>
                <input
                  defaultValue={settings.llm_image_model ?? ""}
                  placeholder="gpt-image-1"
                  onBlur={(e) => void saveSettings({ llm_image_model: e.target.value.trim() || null })}
                  dir="ltr"
                />
              </label>
              <button
                type="button"
                className="whatsapp-button"
                disabled={!llmApiKeyDraft.trim()}
                onClick={async () => {
                  const ok = await saveSettings({
                    llm_api_key: llmApiKeyDraft.trim(),
                    llm_enabled: true
                  });
                  if (ok) setLlmApiKeyDraft("");
                }}
              >
                حفظ وربط المزود
              </button>
            </aside>
          </div>
        </section>
      )}

      {tab === "activity" && (
        <section className="ai-panel">
          <div className="ai-panel-head">
            <h2>سجل النشاط</h2>
          </div>

          <div className="ai-activity-filters">
            <label className="field-label">
              <span>الوقت</span>
              <select
                value={activityRange}
                onChange={(e) => setActivityRange(e.target.value === "7" ? "7" : "all")}
              >
                <option value="all">كل الوقت</option>
                <option value="7">آخر 7 أيام</option>
              </select>
            </label>
            <label className="field-label">
              <span>القناة</span>
              <input
                value={selectedWa ? selectedWa.channel_name || selectedWa.verified_name || channelTitle(selectedWa) : "—"}
                readOnly
              />
            </label>
          </div>

          <div className="ai-activity-table" role="table" aria-label="سجل نشاط الذكاء">
            <div className="ai-activity-head" role="row">
              <span role="columnheader">الوقت</span>
              <span role="columnheader">الحدث</span>
              <span role="columnheader">السبب</span>
            </div>
            {filteredActivity.map((row) => {
              const event = activityEventLabel(row.outcome);
              return (
                <div key={row.id} className="ai-activity-row" role="row">
                  <span role="cell" className="ai-activity-time">
                    {formatActivityTime(row.created_at)}
                  </span>
                  <span role="cell" className={`ai-activity-event ${event.className}`}>
                    <span className="ai-event-icon" aria-hidden />
                    {event.label}
                  </span>
                  <span role="cell" className="ai-activity-reason">
                    {row.reason_text || "—"}
                  </span>
                </div>
              );
            })}
            {!filteredActivity.length && (
              <p className="hint-text" style={{ padding: "12px 4px" }}>
                لا أحداث بعد لهذه القناة.
              </p>
            )}
          </div>
        </section>
      )}
      </div>
    </main>
  );
}
