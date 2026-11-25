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

type PageTab = "ops" | "lab" | "templates" | "activity";

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

export default function AiAgentPage() {
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<PageTab>(searchParams.get("lab") === "1" ? "lab" : "ops");
  const [channelId, setChannelId] = useState(searchParams.get("channel_id") || "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);

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

  const metricsQuery = useQuery({
    queryKey: ["ai-metrics", channelId],
    enabled: Boolean(channelId) && tab === "activity",
    queryFn: async () =>
      (
        await api.get<{
          total: number;
          suggest_count: number;
          auto_reply_count: number;
          escalate_count: number;
          unresolved_count: number;
          days: number;
        }>(`/knowledge/ai/metrics?channel_id=${encodeURIComponent(channelId)}&days=7`)
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
    // runLabTurn closes over latest channel/dialogue; intentional one-shot seed from inbox
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
    } catch {
      toastStore.getState().show("تعذر توليد القالب. تأكد من المزود الخارجي.", "error");
    } finally {
      setTemplateBusy(false);
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
  const suggestOn = agentOn && Boolean(settings?.auto_kb_on_inbound);
  const autoOn = agentOn && Boolean(settings?.auto_reply_on_inbound);

  return (
    <main className="page knowledge-page ai-ops-page">
      <header className="page-header catalog-hero">
        <div>
          <span className="eyebrow whatsapp-eyebrow">AI Ops</span>
          <h1>الذكاء الاصطناعي</h1>
          <p>لوحة تشغيل واختبار حسب قناة واتساب — نفس قواعد الكتالوج والمعرفة الحية.</p>
        </div>
      </header>

      <section className="card knowledge-agent-card knowledge-panel-shell ai-channel-sticky">
        <div className="knowledge-fields-row ai-channel-row">
          <label className="field-label">
            <span>قناة واتساب</span>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {!waList.length && <option value="">لا توجد قنوات</option>}
              {waList.map((wa) => (
                <option key={wa.id} value={wa.channel_id}>
                  {channelTitle(wa)}
                </option>
              ))}
            </select>
          </label>
          <div className="catalog-card-actions" style={{ alignItems: "end" }}>
            <button type="button" className="secondary-button" onClick={() => void toggleAccountKill()}>
              {settings?.account_agent_enabled === false
                ? "تشغيل الذكاء لجميع القنوات"
                : "إيقاف الذكاء لجميع القنوات"}
            </button>
            <button
              type="button"
              className="whatsapp-button"
              onClick={() => {
                setTab("lab");
                resetLab();
              }}
            >
              جرّب محادثة
            </button>
          </div>
        </div>

        {replyMode && (
          <article className={`ai-reply-status ${modeClass(replyMode.mode)}`} aria-live="polite">
            <div>
              <span className="agent-power-eyebrow">إذا كتب العميل الآن على {selectedWa ? channelTitle(selectedWa) : "هذه القناة"}</span>
              <strong>{replyMode.label}</strong>
              <p>{replyMode.reason_text}</p>
              {(replyMode.blockers ?? []).map((item) => (
                <p key={item.code} className="hint-text">
                  السبب: {item.text} — {item.action}
                </p>
              ))}
            </div>
          </article>
        )}

        <div className="catalog-filter-tabs knowledge-status-tabs" style={{ marginTop: 12 }}>
          {(
            [
              ["ops", "التشغيل"],
              ["lab", "التجربة والجودة"],
              ["templates", "القوالب"],
              ["activity", "سجل النشاط"]
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "ops" && settings && (
        <>
          <section className="card knowledge-agent-card knowledge-panel-shell">
            <div className="knowledge-panel-intro">
              <span className="knowledge-panel-kicker">تشغيل القناة</span>
              <h2 className="section-title">إعدادات {selectedWa ? channelTitle(selectedWa) : "القناة"}</h2>
              <p className="hint-text">التغيير هنا يخص هذه القناة فقط ولا يغيّر قنوات أخرى.</p>
            </div>
            <div className="agent-section-grid">
              <article className="agent-section-card accent-internal">
                <header className="agent-section-head">
                  <div className="agent-section-title-row">
                    <span className="agent-section-index">1</span>
                    <div>
                      <h3>ذكاء القناة</h3>
                      <p>تشغيل/إيقاف الذكاء لهذه القناة فقط.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`agent-state-toggle ${agentOn ? "is-on" : "is-off"}`}
                    disabled={settings.account_agent_enabled === false}
                    onClick={() => void saveSettings({ agent_enabled: !settings.agent_enabled })}
                  >
                    {agentOn ? "يعمل" : "متوقف"}
                  </button>
                </header>
              </article>

              <article className="agent-section-card accent-internal">
                <header className="agent-section-head">
                  <div className="agent-section-title-row">
                    <span className="agent-section-index">2</span>
                    <div>
                      <h3>المحرك الداخلي</h3>
                      <p>معرفة + كتالوج هذه القناة فقط.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`agent-state-toggle ${localOn ? "is-on" : "is-off"}`}
                    disabled={!agentOn}
                    onClick={() =>
                      void saveSettings({ local_engine_enabled: settings.local_engine_enabled === false })
                    }
                  >
                    {localOn ? "يعمل" : "متوقف"}
                  </button>
                </header>
              </article>

              <article className="agent-section-card accent-inbound">
                <header className="agent-section-head">
                  <div className="agent-section-title-row">
                    <span className="agent-section-index">3</span>
                    <div>
                      <h3>اقتراح للموظف</h3>
                      <p>يظهر في الوارد فقط — لا يُرسل للعميل.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`agent-state-toggle ${suggestOn ? "is-on" : "is-off"}`}
                    disabled={!agentOn}
                    onClick={() => void saveSettings({ auto_kb_on_inbound: !settings.auto_kb_on_inbound })}
                  >
                    {suggestOn ? "يعمل" : "متوقف"}
                  </button>
                </header>
              </article>

              <article className="agent-section-card accent-auto-reply">
                <header className="agent-section-head">
                  <div className="agent-section-title-row">
                    <span className="agent-section-index">4</span>
                    <div>
                      <h3>رد تلقائي للعميل</h3>
                      <p>إرسال حي عبر واتساب. الافتراضي متوقف عند الترقية.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`agent-state-toggle ${autoOn ? "is-on" : "is-off"}`}
                    disabled={!agentOn}
                    onClick={() =>
                      void saveSettings({ auto_reply_on_inbound: !settings.auto_reply_on_inbound })
                    }
                  >
                    {autoOn ? "يعمل" : "متوقف"}
                  </button>
                </header>
                {autoOn && !replyMode?.engine_ready && (
                  <p className="agent-section-note">فعّل الداخلي أو الخارجي قبل الاعتماد على الرد التلقائي.</p>
                )}
              </article>

              <article className="agent-section-card accent-internal">
                <header className="agent-section-head">
                  <div className="agent-section-title-row">
                    <span className="agent-section-index">5</span>
                    <div>
                      <h3>وضع الرد</h3>
                      <p>كيف يختار المحرك بين المعرفة والكتالوج.</p>
                    </div>
                  </div>
                </header>
                <label className="field-label">
                  <span>الوضع</span>
                  <select
                    value={settings.default_mode}
                    disabled={!agentOn || !localOn}
                    onChange={(e) =>
                      void saveSettings({ default_mode: e.target.value as AgentSettings["default_mode"] })
                    }
                  >
                    {Object.entries(MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            </div>
          </section>

          <section className="card knowledge-agent-card knowledge-panel-shell">
            <button type="button" className="secondary-button" onClick={() => setHoursOpen((v) => !v)}>
              {hoursOpen ? "إخفاء لائحة الدوام" : "إظهار لائحة الدوام"}
            </button>
            {hoursOpen && (
              <div className="agent-hours-box" style={{ marginTop: 12 }}>
                <label className="checkbox-row" style={{ marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.auto_reply_outside_hours)}
                    disabled={!agentOn}
                    onChange={() =>
                      void saveSettings({ auto_reply_outside_hours: !settings.auto_reply_outside_hours })
                    }
                  />
                  <span>رد خارج الدوام</span>
                </label>
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
                <button type="button" className="whatsapp-button" disabled={!hoursDirty} onClick={() => void saveBusinessHours()}>
                  حفظ ساعات العمل
                </button>
              </div>
            )}
          </section>

          <section className="card knowledge-agent-card knowledge-panel-shell">
            <button type="button" className="secondary-button" onClick={() => setProvidersOpen((v) => !v)}>
              {providersOpen ? "إخفاء المزودات" : "إظهار المزودات الخارجية"}
            </button>
            {providersOpen && (
              <div style={{ marginTop: 12 }}>
                <article className="agent-section-card accent-external">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index">E</span>
                      <div>
                        <h3>المزود الخارجي</h3>
                        <p>الحالة: {llmStatusLabel(settings)} · النموذج: {settings.llm_model || "gpt-4o-mini"}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${llmOn ? "is-on" : "is-off"}`}
                      disabled={!settings.llm_available || !agentOn}
                      onClick={() => void saveSettings({ llm_enabled: !settings.llm_enabled })}
                    >
                      {llmOn ? "يعمل" : settings.llm_available ? "متوقف" : "غير جاهز"}
                    </button>
                  </header>
                  <p className="hint-text">المحرك المحلي يعمل بدون مفتاح خارجي. نموذج الرد منفصل عن توليد الصور.</p>
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
                        onBlur={(e) => void saveSettings({ llm_api_base_url: e.target.value.trim() || null })}
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
                  </div>
                  <button type="button" className="whatsapp-button" onClick={() => void saveLlmApiKey()} disabled={!llmApiKeyDraft.trim()}>
                    حفظ المفتاح
                  </button>
                </article>
              </div>
            )}
          </section>

          <section className="card knowledge-preview-card">
            <button type="button" className="secondary-button" onClick={() => setAdvancedOpen((v) => !v)}>
              {advancedOpen ? "إخفاء الإعدادات المتقدمة" : "إظهار الإعدادات المتقدمة"}
            </button>
            {advancedOpen && (
              <div className="knowledge-fields-row" style={{ marginTop: 12 }}>
                <label className="field-label">
                  <span>النبرة</span>
                  <select
                    value={settings.tone}
                    onChange={(e) => void saveSettings({ tone: e.target.value as AgentSettings["tone"] })}
                  >
                    <option value="friendly">ودّية</option>
                    <option value="formal">رسمية</option>
                    <option value="concise">مختصرة</option>
                  </select>
                </label>
                <label className="field-label">
                  <span>حد جولات التوضيح قبل التحويل</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={settings.clarify_max_rounds ?? 2}
                    onBlur={(e) => void saveSettings({ clarify_max_rounds: Number(e.target.value) || 2 })}
                  />
                </label>
                <p className="hint-text">
                  المعرفة والقواعد: <Link to="/knowledge">قاعدة المعرفة</Link>
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {tab === "lab" && (
        <section className="card knowledge-agent-card knowledge-panel-shell">
          <div className="knowledge-panel-intro">
            <span className="knowledge-panel-kicker">مختبر</span>
            <h2 className="section-title">محادثة واتساب داخلية (تجربة معزولة)</h2>
            <p className="hint-text">
              لا يُرسل واتساب ولا يُنشأ طلب حقيقي. القناة: {selectedWa ? channelTitle(selectedWa) : "—"}
            </p>
          </div>
          <div className="knowledge-fields-row">
            <label className="field-label">
              <span>اسم العميل في التجربة</span>
              <input value={labContactName} onChange={(e) => setLabContactName(e.target.value)} />
            </label>
            <div className="catalog-card-actions" style={{ alignItems: "end" }}>
              <button type="button" className="secondary-button" onClick={resetLab}>
                بدء محادثة جديدة
              </button>
            </div>
          </div>

          <div className="ai-lab-thread">
            {labTurns.length === 0 && <p className="hint-text">اكتب رسالة العميل للبدء…</p>}
            {labTurns.map((turn, index) => (
              <article key={`${turn.role}-${index}`} className={`ai-lab-bubble is-${turn.role}`}>
                <strong>{turn.role === "customer" ? "العميل" : "المساعد"}</strong>
                {turn.role === "assistant" ? <WhatsAppTextPreview text={turn.text} compact /> : <p>{turn.text}</p>}
              </article>
            ))}
          </div>

          <form
            className="knowledge-fields-row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void runLabTurn();
            }}
          >
            <label className="field-label" style={{ flex: 1 }}>
              <span>رسالة العميل</span>
              <input
                value={labInput}
                onChange={(e) => setLabInput(e.target.value)}
                placeholder="أبي حبتين rose soap ٩٥ غ"
                disabled={labBusy}
              />
            </label>
            <button type="submit" className="whatsapp-button" disabled={labBusy || !labInput.trim()}>
              {labBusy ? "…" : "إرسال في المختبر"}
            </button>
          </form>

          {(lastReason || lastUnderstood) && (
            <div className="knowledge-preview-layout" style={{ marginTop: 12 }}>
              <p className="hint-text">سبب الرد: {lastReason || "—"}</p>
              {lastUnderstood && (
                <pre className="hint-text" style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(lastUnderstood, null, 2)}
                </pre>
              )}
              {labDialogue?.cart != null && (
                <p className="hint-text">السلة: {JSON.stringify(labDialogue.cart)}</p>
              )}
              <p className="hint-text">واتساب مرسل: 0 · طلبات منشأة: 0</p>
            </div>
          )}

          <hr />
          <h3 className="section-title-sm">مختبر جودة سريع</h3>
          <textarea rows={4} value={qualityCasesText} onChange={(e) => setQualityCasesText(e.target.value)} />
          <button type="button" className="secondary-button" onClick={() => void runQualityLab()} disabled={qualityLoading}>
            {qualityLoading ? "جاري القياس…" : "تشغيل الحالات"}
          </button>
          {qualityResult && (
            <p className="hint-text">
              الإصابة: {qualityResult.hits}/{qualityResult.total} (
              {Math.min(100, Math.round(qualityResult.hit_rate * 100))}%)
            </p>
          )}
        </section>
      )}

      {tab === "templates" && (
        <section className="card knowledge-agent-card knowledge-panel-shell">
          <div className="knowledge-panel-intro">
            <span className="knowledge-panel-kicker">قوالب القناة</span>
            <h2 className="section-title">مكتبة مسودات + فحص داخلي ثم ميتا</h2>
          </div>
          <label className="field-label">
            <span>موضوع القالب</span>
            <textarea rows={2} value={templateTopic} onChange={(e) => setTemplateTopic(e.target.value)} />
          </label>
          <div className="catalog-card-actions">
            <button type="button" className="whatsapp-button" disabled={templateBusy} onClick={() => void generateTemplate()}>
              توليد مسودة
            </button>
            <button type="button" className="secondary-button" disabled={templateBusy} onClick={() => void generateThreeAngles()}>
              توليد 3 بدائل
            </button>
            <button type="button" className="secondary-button" disabled={!templateDraft} onClick={() => void saveCurrentDraft("draft")}>
              حفظ مسودة
            </button>
            <button type="button" className="secondary-button" disabled={!templateDraft} onClick={() => void saveCurrentDraft("rejected")}>
              رفض
            </button>
            <button type="button" className="whatsapp-button" disabled={!templateDraft} onClick={() => void approveDraftToMeta()}>
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
                    onChange={(e) => setTemplateDraft((c) => (c ? { ...c, body_text: e.target.value } : c))}
                  />
                </label>
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
                  <button type="button" className="secondary-button compact" onClick={() => setTemplateDraft(item)}>
                    استخدام
                  </button>
                </article>
              ))}
            </div>
          )}
          <h3 className="section-title-sm">مسودات محفوظة لهذه القناة</h3>
          <div className="knowledge-matched-list">
            {(draftsQuery.data ?? []).map((item) => (
              <article key={item.id} className="inbox-kb-card">
                <strong>
                  {item.topic || item.draft?.name} · {item.status}
                </strong>
                <p className="hint-text">
                  فحص داخلي: {item.internal_check?.ok ? "جاهز" : (item.internal_check?.issues || []).join("، ") || "—"}
                  {" · "}
                  ميتا: {item.meta_status || "لم يُرسل"}
                </p>
                <button type="button" className="secondary-button compact" onClick={() => setTemplateDraft(item.draft)}>
                  فتح
                </button>
              </article>
            ))}
            {!draftsQuery.data?.length && <p className="hint-text">لا مسودات بعد.</p>}
          </div>
        </section>
      )}

      {tab === "activity" && (
        <section className="card knowledge-agent-card knowledge-panel-shell">
          <div className="knowledge-panel-intro">
            <span className="knowledge-panel-kicker">سجل</span>
            <h2 className="section-title">قرارات الذكاء لهذه القناة</h2>
          </div>
          {metricsQuery.data && (
            <div className="brand-stat-row knowledge-status-strip">
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">إجمالي ({metricsQuery.data.days}ي)</span>
                <strong className="brand-stat-value">{metricsQuery.data.total}</strong>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">اقتراحات</span>
                <strong className="brand-stat-value">{metricsQuery.data.suggest_count}</strong>
                <small className="brand-stat-meta">من {metricsQuery.data.total}</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">ردود تلقائية</span>
                <strong className="brand-stat-value">{metricsQuery.data.auto_reply_count}</strong>
                <small className="brand-stat-meta">من {metricsQuery.data.total}</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">تحويل/تعذّر</span>
                <strong className="brand-stat-value">
                  {metricsQuery.data.escalate_count + metricsQuery.data.unresolved_count}
                </strong>
              </article>
            </div>
          )}
          <div className="knowledge-matched-list">
            {(activityQuery.data ?? []).map((row) => (
              <article key={row.id} className="inbox-kb-card">
                <strong>
                  {row.source === "lab" ? "اختبار" : "حي"} · {row.outcome}
                </strong>
                <p className="hint-text">{row.reason_text}</p>
                {row.query_text && <p className="hint-text">س: {row.query_text}</p>}
                {row.suggestion && <p className="hint-text">ج: {row.suggestion.slice(0, 160)}</p>}
                <p className="hint-text">{row.created_at}</p>
              </article>
            ))}
            {!activityQuery.data?.length && <p className="hint-text">لا أحداث بعد لهذه القناة.</p>}
          </div>
        </section>
      )}
    </main>
  );
}
