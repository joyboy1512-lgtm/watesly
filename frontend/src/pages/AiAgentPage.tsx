import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  SOURCE_LABELS,
  type AgentSettings,
  type AgentSettingsPatch,
  type BusinessHoursConfig,
  type QualityEvalResult,
  type SmartReplyResult
} from "../lib/knowledgeHelpers";
import {
  buildStoredComponents,
  type TemplateButton,
  type TemplateHeaderFormat
} from "../lib/templateMedia";
import { type UploadedFile } from "../lib/uploads";
import { type WhatsAppAccountRow } from "../lib/whatsappHelpers";
import { toastStore } from "../stores/toast";

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

type AiProviderForm = {
  label: string;
  llm_api_key: string;
  llm_api_base_url: string;
  llm_model: string;
};

const emptyProviderForm = (): AiProviderForm => ({
  label: "OpenAI متوافق",
  llm_api_key: "",
  llm_api_base_url: "https://api.openai.com/v1",
  llm_model: "gpt-4o-mini"
});

export default function AiAgentPage() {
  const client = useQueryClient();
  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState("");
  const [hoursDraft, setHoursDraft] = useState<BusinessHoursConfig | null>(null);
  const [hoursDirty, setHoursDirty] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerForm, setProviderForm] = useState<AiProviderForm>(emptyProviderForm);

  const [testQuery, setTestQuery] = useState("");
  const [testContactName, setTestContactName] = useState("");
  const [testChannelId, setTestChannelId] = useState("");
  const [testMode, setTestMode] = useState<AgentSettings["default_mode"]>("kb_first");
  const [testResult, setTestResult] = useState<SmartReplyResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const [qualityCasesText, setQualityCasesText] = useState(
    "ما مدة التوصيل؟\nكم السعر؟\nكيف أرجع الطلب؟\nهل الفرع مفتوح؟"
  );
  const [qualityResult, setQualityResult] = useState<QualityEvalResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  const [templateTopic, setTemplateTopic] = useState("");
  const [templateBrandHint, setTemplateBrandHint] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState("ar");
  const [templateCategory, setTemplateCategory] = useState("marketing");
  const [templateAccountId, setTemplateAccountId] = useState("");
  const [templateDraft, setTemplateDraft] = useState<AiTemplateDraft | null>(null);
  const [templateRefineNote, setTemplateRefineNote] = useState("");
  const [templateHeaderFile, setTemplateHeaderFile] = useState<UploadedFile | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateImageBusy, setTemplateImageBusy] = useState(false);
  const [templateSubmitBusy, setTemplateSubmitBusy] = useState(false);

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });
  const waList = whatsappAccounts.data ?? [];

  const agentSettings = useQuery({
    queryKey: ["knowledge-agent-settings"],
    queryFn: async () => (await api.get<AgentSettings>("/knowledge/agent-settings")).data
  });

  useEffect(() => {
    const firstChannel = waList[0]?.channel_id;
    const firstAccount = waList[0]?.id;
    if (firstChannel) setTestChannelId((current) => current || firstChannel);
    if (firstAccount) setTemplateAccountId((current) => current || firstAccount);
  }, [waList]);

  useEffect(() => {
    if (agentSettings.data?.default_mode) {
      setTestMode(agentSettings.data.default_mode);
    }
  }, [agentSettings.data?.default_mode]);

  useEffect(() => {
    if (!agentSettings.data || hoursDirty) return;
    setHoursDraft(normalizeBusinessHours(agentSettings.data.business_hours_json));
  }, [agentSettings.data, hoursDirty]);

  const settings = agentSettings.data;

  const previewComponents = useMemo(() => {
    if (!templateDraft) return [];
    const headerType =
      templateDraft.header_type === "IMAGE"
        ? ("IMAGE" as TemplateHeaderFormat)
        : templateDraft.header_type === "TEXT"
          ? ("TEXT" as TemplateHeaderFormat)
          : null;
    return buildStoredComponents(
      templateDraft.body_text,
      templateHeaderFile,
      headerType,
      {
        category: templateDraft.category,
        includeMarketingOptOut: templateDraft.category === "marketing",
        headerText: templateDraft.header_text,
        footerText: templateDraft.footer_text,
        customButtons: templateDraft.buttons ?? [],
        bodySamples: templateDraft.body_samples ?? []
      }
    );
  }, [templateDraft, templateHeaderFile]);

  const previewBusinessName = useMemo(() => {
    const account = waList.find((item) => item.id === templateAccountId);
    return account?.verified_name || account?.channel_name || account?.display_phone_number || "نشاطك التجاري";
  }, [waList, templateAccountId]);

  async function saveAgentSettings(patch: AgentSettingsPatch) {
    try {
      await api.patch("/knowledge/agent-settings", patch);
      await client.invalidateQueries({ queryKey: ["knowledge-agent-settings"] });
      toastStore.getState().show("تم حفظ إعدادات الذكاء.", "success");
      return true;
    } catch {
      toastStore.getState().show("تعذر حفظ الإعدادات.", "error");
      return false;
    }
  }

  async function saveLlmApiKey() {
    const value = llmApiKeyDraft.trim();
    if (!value) {
      toastStore.getState().show("أدخل مفتاح API أولاً.", "error");
      return;
    }
    const ok = await saveAgentSettings({ llm_api_key: value });
    if (ok) setLlmApiKeyDraft("");
  }

  async function clearLlmApiKey() {
    if (!window.confirm("حذف مفتاح API المحفوظ لهذا الحساب؟")) return;
    const ok = await saveAgentSettings({ clear_llm_api_key: true });
    if (ok) setLlmApiKeyDraft("");
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    const patch: AgentSettingsPatch = {
      llm_api_base_url: providerForm.llm_api_base_url.trim() || null,
      llm_model: providerForm.llm_model.trim() || null,
      llm_enabled: true
    };
    if (providerForm.llm_api_key.trim()) {
      patch.llm_api_key = providerForm.llm_api_key.trim();
    }
    const ok = await saveAgentSettings(patch);
    if (ok) {
      setShowProviderForm(false);
      setProviderForm(emptyProviderForm());
    }
  }

  async function saveBusinessHours() {
    if (!hoursDraft) return;
    const ok = await saveAgentSettings({ business_hours_json: hoursDraft });
    if (ok) setHoursDirty(false);
  }

  function updateHoursDay(day: string, patch: { open?: boolean; start?: string; end?: string }) {
    setHoursDraft((current) => {
      const base = current ?? normalizeBusinessHours(agentSettings.data?.business_hours_json);
      const existing = base.days[day];
      const open = patch.open ?? existing != null;
      const nextSlot = open
        ? ([patch.start ?? existing?.[0] ?? "09:00", patch.end ?? existing?.[1] ?? "18:00"] as [string, string])
        : null;
      setHoursDirty(true);
      return {
        ...base,
        days: { ...base.days, [day]: nextSlot }
      };
    });
  }

  async function testAi() {
    if (!testQuery.trim()) return;
    setTestLoading(true);
    try {
      const result = await api.post<SmartReplyResult>("/knowledge/suggest-reply", {
        query: testQuery.trim(),
        contact_name: testContactName.trim(),
        mode: testMode,
        use_llm: false,
        channel_id: testChannelId || null
      });
      setTestResult(result.data);
    } catch {
      toastStore.getState().show("تعذر توليد الرد.", "error");
    } finally {
      setTestLoading(false);
    }
  }

  async function runQualityLab() {
    const cases = qualityCasesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((query) => ({ query }));
    if (cases.length === 0) {
      toastStore.getState().show("أضف سؤالًا واحدًا على الأقل.", "error");
      return;
    }
    setQualityLoading(true);
    try {
      const result = await evaluateKnowledgeQuality(cases);
      setQualityResult(result.data);
      toastStore.getState().show(`نسبة الإصابة: ${Math.round(result.data.hit_rate * 100)}%`, "success");
    } catch {
      toastStore.getState().show("تعذر تشغيل مختبر الجودة.", "error");
    } finally {
      setQualityLoading(false);
    }
  }

  async function generateTemplateDraft() {
    if (!templateTopic.trim()) {
      toastStore.getState().show("اكتب موضوع القالب أولاً.", "error");
      return;
    }
    setTemplateBusy(true);
    try {
      const result = await api.post<AiTemplateDraft>("/templates/ai/generate", {
        topic: templateTopic.trim(),
        language: templateLanguage,
        category: templateCategory,
        brand_hint: templateBrandHint.trim() || null
      });
      setTemplateDraft(result.data);
      setTemplateHeaderFile(null);
      toastStore.getState().show("تم توليد مسودة القالب.", "success");
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (detail === "LLM_NOT_CONFIGURED") {
        toastStore.getState().show("فعّل الذكاء الخارجي وأضف مفتاح API أولاً.", "error");
      } else {
        toastStore.getState().show("تعذر توليد القالب.", "error");
      }
    } finally {
      setTemplateBusy(false);
    }
  }

  async function refineTemplateDraft() {
    if (!templateDraft || !templateRefineNote.trim()) return;
    setTemplateBusy(true);
    try {
      const result = await api.post<AiTemplateDraft>("/templates/ai/refine", {
        draft: templateDraft,
        instruction: templateRefineNote.trim()
      });
      setTemplateDraft(result.data);
      setTemplateRefineNote("");
      toastStore.getState().show("تم تعديل المسودة.", "success");
    } catch {
      toastStore.getState().show("تعذر تعديل المسودة.", "error");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function generateTemplateImage() {
    if (!templateDraft) return;
    const prompt = (templateDraft.image_prompt || templateTopic || templateDraft.header_text || "").trim();
    if (!prompt) {
      toastStore.getState().show("أضف وصف صورة أولاً.", "error");
      return;
    }
    setTemplateImageBusy(true);
    try {
      const result = await api.post<UploadedFile & { prompt?: string }>("/templates/ai/image", { prompt });
      setTemplateHeaderFile(result.data);
      setTemplateDraft((current) =>
        current
          ? {
              ...current,
              header_type: "IMAGE",
              image_prompt: prompt
            }
          : current
      );
      toastStore.getState().show("تم توليد صورة الرأس.", "success");
    } catch {
      toastStore.getState().show("تعذر توليد الصورة. تأكد أن مزودك يدعم توليد الصور.", "error");
    } finally {
      setTemplateImageBusy(false);
    }
  }

  async function approveAndSubmitTemplate(submitToMeta: boolean) {
    if (!templateDraft) return;
    if (!templateAccountId) {
      toastStore.getState().show("اختر حساب واتساب.", "error");
      return;
    }
    if (templateDraft.header_type === "IMAGE" && !templateHeaderFile) {
      toastStore.getState().show("ولّد أو ارفع صورة الرأس قبل الاعتماد.", "error");
      return;
    }
    setTemplateSubmitBusy(true);
    try {
      const created = await api.post<{ id: string; status: string; meta_status_detail?: string | null }>(
        "/templates",
        {
          whatsapp_account_id: templateAccountId,
          name: templateDraft.name,
          language: templateDraft.language || "ar",
          category: templateDraft.category || "marketing",
          body_text: templateDraft.body_text,
          components: previewComponents,
          submit_to_meta: submitToMeta
        }
      );
      await client.invalidateQueries({ queryKey: ["templates"] });
      if (submitToMeta) {
        toastStore.getState().show(
          created.data.status === "pending"
            ? "تم الاعتماد وإرسال القالب إلى ميتا للموافقة."
            : created.data.status === "rejected"
              ? `ميتّا رفضت القالب: ${created.data.meta_status_detail || "راجع التفاصيل في القوالب"}`
              : "تم حفظ القالب.",
          created.data.status === "rejected" ? "error" : "success"
        );
      } else {
        toastStore.getState().show("تم حفظ مسودة القالب بدون إرسال لميتا.", "success");
      }
    } catch {
      toastStore.getState().show("تعذر اعتماد القالب.", "error");
    } finally {
      setTemplateSubmitBusy(false);
    }
  }

  return (
    <main className="page knowledge-page">
      <header className="page-header catalog-hero">
        <div>
          <span className="eyebrow whatsapp-eyebrow">AI Agent</span>
          <h1>الذكاء الاصطناعي</h1>
          <p>تحكم منفصل بالداخلي والخارجي، مع مساعدة لتوليد القوالب واعتمادها لدى ميتا.</p>
          {settings && (
            <div className="brand-stat-row knowledge-status-strip" aria-live="polite">
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">الوكيل</span>
                <strong className="brand-stat-value">{settings.agent_enabled !== false ? "يعمل" : "متوقف"}</strong>
                <small className="brand-stat-meta">الحالة العامة</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">داخلي</span>
                <strong className="brand-stat-value">
                  {settings.agent_enabled !== false && settings.local_engine_enabled !== false ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">معرفة + كتالوج</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">خارجي</span>
                <strong className="brand-stat-value">
                  {settings.agent_enabled !== false && settings.llm_enabled && settings.llm_available ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">{llmStatusLabel(settings)}</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">رد تلقائي</span>
                <strong className="brand-stat-value">
                  {settings.agent_enabled !== false && settings.auto_reply_on_inbound ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">إرسال للعميل</small>
              </article>
            </div>
          )}
        </div>
      </header>

      {settings && (() => {
        const agentOn = settings.agent_enabled !== false;
        const localOn = agentOn && settings.local_engine_enabled !== false;
        const inboundOn = agentOn && settings.auto_kb_on_inbound;
        const autoReplyOn = agentOn && Boolean(settings.auto_reply_on_inbound);
        const outsideOn = agentOn && Boolean(settings.auto_reply_outside_hours);
        const llmOn = agentOn && Boolean(settings.llm_enabled && settings.llm_available);
        return (
          <>
            <section className="card knowledge-agent-card knowledge-panel-shell">
              <div className="knowledge-panel-intro">
                <span className="knowledge-panel-kicker">التحكم</span>
                <h2 className="section-title">الحالة العامة</h2>
                <p className="hint-text">تشغيل/إيقاف شامل لكل خدمات الذكاء في الحساب.</p>
              </div>
              <div className={`agent-power-bar ${agentOn ? "is-on" : "is-off"}`}>
                <div className="agent-power-copy">
                  <span className="agent-power-eyebrow">وكيل واتساب</span>
                  <strong>{agentOn ? "يعمل الآن" : "متوقف"}</strong>
                  <p>
                    {agentOn
                      ? "الأقسام أدناه تعمل حسب مفاتيحها الفردية."
                      : "كل الآلي متوقف. يمكنك الإبقاء على الاختبار اليدوي فقط."}
                  </p>
                </div>
                <button
                  type="button"
                  className={`agent-power-button ${agentOn ? "is-on" : "is-off"}`}
                  onClick={() => void saveAgentSettings({ agent_enabled: !agentOn })}
                >
                  <span className="agent-power-dot" aria-hidden />
                  {agentOn ? "إيقاف الوكيل" : "تشغيل الوكيل"}
                </button>
              </div>
            </section>

            <section className="card knowledge-agent-card knowledge-panel-shell">
              <div className="knowledge-panel-intro">
                <span className="knowledge-panel-kicker">داخلي</span>
                <h2 className="section-title">ذكاء اصطناعي داخلي</h2>
                <p className="hint-text">
                  يعتمد على{" "}
                  <Link to="/knowledge">قاعدة المعرفة</Link> والكتالوج بدون مزود خارجي.
                </p>
              </div>
              <div className="agent-section-grid">
                <article className="agent-section-card accent-internal">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>1</span>
                      <div>
                        <h3>المحرك الداخلي</h3>
                        <p>مطابقة المعرفة والكتالوج عربي/إنجليزي.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${localOn ? "is-on" : "is-off"}`}
                      disabled={!agentOn}
                      onClick={() =>
                        void saveAgentSettings({
                          local_engine_enabled: settings.local_engine_enabled === false
                        })
                      }
                    >
                      {localOn ? "يعمل" : "متوقف"}
                    </button>
                  </header>
                </article>

                <article className="agent-section-card accent-auto-reply">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>2</span>
                      <div>
                        <h3>رد تلقائي للعميل</h3>
                        <p>إرسال الرد الجاهز مباشرة إلى واتساب عند رسالة واردة.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${autoReplyOn ? "is-on" : "is-off"}`}
                      disabled={!agentOn}
                      onClick={() =>
                        void saveAgentSettings({ auto_reply_on_inbound: !settings.auto_reply_on_inbound })
                      }
                    >
                      {autoReplyOn ? "يعمل" : "متوقف"}
                    </button>
                  </header>
                </article>

                <article className="agent-section-card accent-inbound">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>3</span>
                      <div>
                        <h3>رد عند رسالة واردة</h3>
                        <p>اقتراح للموظف داخل الوارد دون إرسال تلقائي.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${inboundOn ? "is-on" : "is-off"}`}
                      disabled={!agentOn}
                      onClick={() => void saveAgentSettings({ auto_kb_on_inbound: !settings.auto_kb_on_inbound })}
                    >
                      {inboundOn ? "يعمل" : "متوقف"}
                    </button>
                  </header>
                </article>

                <article className="agent-section-card accent-internal">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>4</span>
                      <div>
                        <h3>وضع الرد</h3>
                        <p>كيف يختار المحرك بين المعرفة والكتالوج.</p>
                      </div>
                    </div>
                  </header>
                  <div className="knowledge-fields-row">
                    <label className="field-label">
                      <span>الوضع</span>
                      <select
                        value={settings.default_mode}
                        disabled={!agentOn || !localOn}
                        onChange={(e) =>
                          void saveAgentSettings({ default_mode: e.target.value as AgentSettings["default_mode"] })
                        }
                      >
                        {Object.entries(MODE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      <span>النبرة</span>
                      <select
                        value={settings.tone}
                        disabled={!agentOn}
                        onChange={(e) => void saveAgentSettings({ tone: e.target.value as AgentSettings["tone"] })}
                      >
                        <option value="friendly">ودّية</option>
                        <option value="formal">رسمية</option>
                        <option value="concise">مختصرة</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>اللغة</span>
                      <input
                        value={settings.language}
                        disabled={!agentOn}
                        onBlur={(e) => void saveAgentSettings({ language: e.target.value })}
                        onChange={(e) => {
                          const value = e.target.value;
                          void client.setQueryData(["knowledge-agent-settings"], (prev: AgentSettings | undefined) =>
                            prev ? { ...prev, language: value } : prev
                          );
                        }}
                        dir="ltr"
                      />
                    </label>
                  </div>
                </article>

                <article className="agent-section-card accent-hours">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>5</span>
                      <div>
                        <h3>لائحة الدوام</h3>
                        <p>رسالة خارج الساعات إن لم يُرد أحد بعد.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${outsideOn ? "is-on" : "is-off"}`}
                      disabled={!agentOn}
                      onClick={() =>
                        void saveAgentSettings({ auto_reply_outside_hours: !settings.auto_reply_outside_hours })
                      }
                    >
                      {outsideOn ? "يعمل" : "متوقف"}
                    </button>
                  </header>
                  <p className="agent-section-note">
                    الآن: {settings.within_business_hours ? "داخل الدوام" : "خارج الدوام"}
                  </p>
                  <label className="field-label">
                    <span>رسالة خارج الدوام</span>
                    <textarea
                      value={settings.outside_hours_message ?? ""}
                      onBlur={(e) => void saveAgentSettings({ outside_hours_message: e.target.value || null })}
                      rows={2}
                      placeholder="شكراً لتواصلك. نحن خارج ساعات العمل…"
                      disabled={!agentOn}
                    />
                  </label>
                  <div className="agent-hours-box">
                    <label className="field-label">
                      <span>المنطقة الزمنية</span>
                      <input
                        value={hoursDraft?.timezone ?? "Asia/Kuwait"}
                        disabled={!agentOn}
                        onChange={(e) => {
                          setHoursDirty(true);
                          setHoursDraft((current) => ({
                            ...(current ?? normalizeBusinessHours(settings.business_hours_json)),
                            timezone: e.target.value
                          }));
                        }}
                        dir="ltr"
                      />
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
                    <div className="catalog-card-actions">
                      <button
                        type="button"
                        className="whatsapp-button"
                        onClick={() => void saveBusinessHours()}
                        disabled={!hoursDirty || !agentOn}
                      >
                        حفظ ساعات العمل
                      </button>
                      {hoursDirty && <span className="hint-text">هناك تعديلات غير محفوظة</span>}
                    </div>
                  </div>
                </article>
              </div>
            </section>

            <section className="card knowledge-agent-card knowledge-panel-shell">
              <div className="knowledge-panel-intro">
                <span className="knowledge-panel-kicker">خارجي</span>
                <h2 className="section-title">ذكاء اصطناعي خارجي</h2>
                <p className="hint-text">مزودات OpenAI-compatible لصقل الردود وتوليد القوالب والصور.</p>
              </div>
              <div className="agent-section-grid">
                <article className="agent-section-card accent-external">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>1</span>
                      <div>
                        <h3>تشغيل الخارجي</h3>
                        <p>يصقل الرد أو يعمل وحده عند إيقاف الداخلي.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${llmOn ? "is-on" : "is-off"}`}
                      disabled={!settings.llm_available || !agentOn}
                      onClick={() => void saveAgentSettings({ llm_enabled: !settings.llm_enabled })}
                      title={!settings.llm_available ? "أضف مفتاح API أولًا" : undefined}
                    >
                      {llmOn ? "يعمل" : settings.llm_available ? "متوقف" : "غير جاهز"}
                    </button>
                  </header>
                  <p className="agent-section-note">الحالة: {llmStatusLabel(settings)}</p>
                </article>

                <article className="agent-section-card accent-external">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>2</span>
                      <div>
                        <h3>المزودات المربوطة</h3>
                        <p>قائمة مزودات الذكاء المرتبطة بهذا الحساب.</p>
                      </div>
                    </div>
                    <button type="button" className="secondary-button compact" onClick={() => setShowProviderForm(true)}>
                      إضافة ذكاء جديد
                    </button>
                  </header>
                  <div className="knowledge-matched-list">
                    {settings.llm_available ? (
                      <article className="inbox-kb-card">
                        <strong>{settings.llm_model || "gpt-4o-mini"}</strong>
                        <p className="hint-text">
                          {settings.llm_api_base_url || "https://api.openai.com/v1"}
                          {" · "}
                          المصدر: {settings.llm_key_source === "account" ? "مفتاح الحساب" : settings.llm_key_source === "env" ? "بيئة المنصة" : "—"}
                        </p>
                        <div className="catalog-card-actions">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => {
                              setProviderForm({
                                label: "OpenAI متوافق",
                                llm_api_key: "",
                                llm_api_base_url: settings.llm_api_base_url || "https://api.openai.com/v1",
                                llm_model: settings.llm_model || "gpt-4o-mini"
                              });
                              setShowProviderForm(true);
                            }}
                          >
                            تعديل
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact danger-text"
                            onClick={() => void clearLlmApiKey()}
                            disabled={!settings.llm_key_configured}
                          >
                            حذف المفتاح
                          </button>
                        </div>
                      </article>
                    ) : (
                      <p className="hint-text">لا يوجد مزود مربوط بعد — أضف مفتاح API للبدء.</p>
                    )}
                  </div>
                  {showProviderForm && (
                    <form className="stack-form" onSubmit={(e) => void saveProvider(e)}>
                      <label className="field-label">
                        <span>الاسم</span>
                        <input
                          value={providerForm.label}
                          onChange={(e) => setProviderForm((c) => ({ ...c, label: e.target.value }))}
                        />
                      </label>
                      <label className="field-label">
                        <span>مفتاح API</span>
                        <input
                          type="password"
                          value={providerForm.llm_api_key}
                          onChange={(e) => setProviderForm((c) => ({ ...c, llm_api_key: e.target.value }))}
                          placeholder={settings.llm_key_configured ? "اتركه فارغاً للإبقاء على المفتاح الحالي" : "sk-..."}
                          dir="ltr"
                          autoComplete="off"
                        />
                      </label>
                      <div className="knowledge-fields-row">
                        <label className="field-label">
                          <span>Base URL</span>
                          <input
                            value={providerForm.llm_api_base_url}
                            onChange={(e) => setProviderForm((c) => ({ ...c, llm_api_base_url: e.target.value }))}
                            dir="ltr"
                          />
                        </label>
                        <label className="field-label">
                          <span>النموذج</span>
                          <input
                            value={providerForm.llm_model}
                            onChange={(e) => setProviderForm((c) => ({ ...c, llm_model: e.target.value }))}
                            dir="ltr"
                          />
                        </label>
                      </div>
                      <div className="catalog-card-actions">
                        <button type="submit" className="whatsapp-button">حفظ المزود</button>
                        <button type="button" className="secondary-button" onClick={() => setShowProviderForm(false)}>
                          إلغاء
                        </button>
                      </div>
                    </form>
                  )}
                  {!showProviderForm && (
                    <div className="knowledge-fields-row" style={{ marginTop: 12 }}>
                      <label className="field-label">
                        <span>تحديث سريع للمفتاح</span>
                        <input
                          type="password"
                          value={llmApiKeyDraft}
                          onChange={(e) => setLlmApiKeyDraft(e.target.value)}
                          placeholder={settings.llm_key_configured ? "••••••••" : "sk-..."}
                          dir="ltr"
                          autoComplete="off"
                        />
                      </label>
                      <div className="catalog-card-actions" style={{ alignItems: "end" }}>
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
                  )}
                  <label className="field-label">
                    <span>تعليمات النظام للـ LLM</span>
                    <textarea
                      value={settings.llm_system_prompt ?? ""}
                      onBlur={(e) => void saveAgentSettings({ llm_system_prompt: e.target.value || null })}
                      rows={3}
                      placeholder="مثال: أجب باختصار باللهجة الكويتية…"
                      disabled={!agentOn}
                    />
                  </label>
                </article>
              </div>
            </section>
          </>
        );
      })()}

      <section className="card knowledge-agent-card knowledge-panel-shell knowledge-tools-shell">
        <div className="knowledge-panel-intro">
          <span className="knowledge-panel-kicker">خدمة</span>
          <h2 className="section-title">مساعدة القوالب</h2>
          <p className="hint-text">
            توليد واقتراح وتعديل قالب حسب الموضوع، مع صورة رأس اختيارية، ثم الاعتماد وترحيله إلى ميتا.
          </p>
        </div>
        <div className="agent-section-grid knowledge-tools-grid">
          <div className="agent-section-card accent-generate stack-form">
            <header className="agent-section-head">
              <div className="agent-section-title-row">
                <span className="agent-section-index" aria-hidden>1</span>
                <div>
                  <h3>توليد حسب الموضوع</h3>
                  <p>صف العرض أو الرسالة المطلوبة بالعربية أو الإنجليزية.</p>
                </div>
              </div>
            </header>
            <label className="field-label">
              <span>الموضوع</span>
              <textarea
                rows={3}
                value={templateTopic}
                onChange={(e) => setTemplateTopic(e.target.value)}
                placeholder="مثال: عرض رمضان على أطقم المائدة مع خصم وزر تسوق"
              />
            </label>
            <label className="field-label">
              <span>تلميح العلامة / النشاط (اختياري)</span>
              <input
                value={templateBrandHint}
                onChange={(e) => setTemplateBrandHint(e.target.value)}
                placeholder="Three Shiny · أدوات منزلية"
              />
            </label>
            <div className="knowledge-fields-row">
              <label className="field-label">
                <span>اللغة</span>
                <input value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} dir="ltr" />
              </label>
              <label className="field-label">
                <span>الفئة</span>
                <select value={templateCategory} onChange={(e) => setTemplateCategory(e.target.value)}>
                  <option value="marketing">تسويقي</option>
                  <option value="utility">خدمي</option>
                </select>
              </label>
              <label className="field-label">
                <span>حساب واتساب</span>
                <select value={templateAccountId} onChange={(e) => setTemplateAccountId(e.target.value)}>
                  {waList.map((wa) => (
                    <option key={wa.id} value={wa.id}>
                      {wa.verified_name || wa.channel_name || wa.display_phone_number}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="whatsapp-button"
              onClick={() => void generateTemplateDraft()}
              disabled={templateBusy || !templateTopic.trim()}
            >
              {templateBusy ? "جاري التوليد…" : "توليد قالب"}
            </button>
          </div>

          {templateDraft && (
            <div className="agent-section-card accent-create stack-form">
              <header className="agent-section-head">
                <div className="agent-section-title-row">
                  <span className="agent-section-index" aria-hidden>2</span>
                  <div>
                    <h3>مراجعة وتعديل</h3>
                    <p>{templateDraft.notes || "راجع المسودة ثم اعتمدها."}</p>
                  </div>
                </div>
              </header>
              <div className="knowledge-fields-row">
                <label className="field-label">
                  <span>الاسم (Meta)</span>
                  <input
                    value={templateDraft.name}
                    onChange={(e) => setTemplateDraft((c) => (c ? { ...c, name: e.target.value } : c))}
                    dir="ltr"
                  />
                </label>
                <label className="field-label">
                  <span>نوع الرأس</span>
                  <select
                    value={templateDraft.header_type}
                    onChange={(e) => setTemplateDraft((c) => (c ? { ...c, header_type: e.target.value } : c))}
                  >
                    <option value="NONE">بدون</option>
                    <option value="TEXT">نص</option>
                    <option value="IMAGE">صورة</option>
                  </select>
                </label>
              </div>
              {templateDraft.header_type === "TEXT" && (
                <label className="field-label">
                  <span>نص الرأس</span>
                  <input
                    value={templateDraft.header_text}
                    onChange={(e) => setTemplateDraft((c) => (c ? { ...c, header_text: e.target.value } : c))}
                  />
                </label>
              )}
              <label className="field-label">
                <span>نص القالب</span>
                <textarea
                  rows={5}
                  value={templateDraft.body_text}
                  onChange={(e) => setTemplateDraft((c) => (c ? { ...c, body_text: e.target.value } : c))}
                />
              </label>
              <label className="field-label">
                <span>التذييل</span>
                <input
                  value={templateDraft.footer_text}
                  onChange={(e) => setTemplateDraft((c) => (c ? { ...c, footer_text: e.target.value } : c))}
                />
              </label>
              <label className="field-label">
                <span>وصف صورة مقترح</span>
                <textarea
                  rows={2}
                  value={templateDraft.image_prompt}
                  onChange={(e) => setTemplateDraft((c) => (c ? { ...c, image_prompt: e.target.value } : c))}
                  dir="ltr"
                />
              </label>
              <div className="catalog-card-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void generateTemplateImage()}
                  disabled={templateImageBusy}
                >
                  {templateImageBusy ? "توليد الصورة…" : "توليد / اقتراح صورة"}
                </button>
              </div>
              {templateHeaderFile?.public_url && (
                <img
                  src={templateHeaderFile.public_url}
                  alt="رأس القالب"
                  style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12 }}
                />
              )}
              <label className="field-label">
                <span>تعديل بالذكاء (اكتب المطلوب)</span>
                <textarea
                  rows={2}
                  value={templateRefineNote}
                  onChange={(e) => setTemplateRefineNote(e.target.value)}
                  placeholder="اجعل النص أقصر وأضف متغير للاسم"
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refineTemplateDraft()}
                disabled={templateBusy || !templateRefineNote.trim()}
              >
                تطبيق التعديل المقترح
              </button>
              <div className="catalog-card-actions">
                <button
                  type="button"
                  className="whatsapp-button"
                  onClick={() => void approveAndSubmitTemplate(true)}
                  disabled={templateSubmitBusy}
                >
                  {templateSubmitBusy ? "جاري الترحيل…" : "اعتماد وترحيل إلى ميتا"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void approveAndSubmitTemplate(false)}
                  disabled={templateSubmitBusy}
                >
                  حفظ مسودة فقط
                </button>
                <Link className="secondary-button" to="/templates">
                  فتح القوالب
                </Link>
              </div>
            </div>
          )}

          {templateDraft && (
            <div className="agent-section-card accent-import">
              <header className="agent-section-head">
                <div className="agent-section-title-row">
                  <span className="agent-section-index" aria-hidden>3</span>
                  <div>
                    <h3>معاينة واتساب</h3>
                    <p>شكل القالب قبل الإرسال لميتا.</p>
                  </div>
                </div>
              </header>
              <WhatsAppTemplatePreview
                businessName={previewBusinessName}
                bodyText={templateDraft.body_text}
                components={previewComponents}
              />
            </div>
          )}
        </div>
      </section>

      <section className="card knowledge-preview-card">
        <h2 className="section-title">تجربة الرد</h2>
        <p className="hint-text">اختبر المحرك على قناة واتساب محددة.</p>
        <div className="knowledge-fields-row">
          <label className="field-label">
            <span>سؤال العميل</span>
            <input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} placeholder="ما مدة التوصيل؟" />
          </label>
          <label className="field-label">
            <span>اسم العميل (اختياري)</span>
            <input value={testContactName} onChange={(e) => setTestContactName(e.target.value)} placeholder="أحمد" />
          </label>
          <label className="field-label">
            <span>قناة واتساب</span>
            <select value={testChannelId} onChange={(e) => setTestChannelId(e.target.value)}>
              {waList.map((wa) => (
                <option key={wa.id} value={wa.channel_id}>
                  {wa.verified_name || wa.channel_name || wa.display_phone_number}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>وضع الرد</span>
            <select value={testMode} onChange={(e) => setTestMode(e.target.value as AgentSettings["default_mode"])}>
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => void testAi()} disabled={!testQuery.trim() || testLoading}>
          {testLoading ? "جاري التوليد…" : "توليد رد"}
        </button>
        {testResult?.suggestion && (
          <div className="knowledge-preview-layout">
            <div className="ai-suggestion-banner">
              <strong>
                مصدر: {SOURCE_LABELS[testResult.source ?? ""] ?? testResult.source ?? "—"}
                {testResult.confidence != null && ` · ثقة ${Math.round(testResult.confidence * 100)}%`}
              </strong>
              <WhatsAppTextPreview text={testResult.suggestion} compact />
            </div>
          </div>
        )}
      </section>

      <section className="card knowledge-preview-card">
        <h2 className="section-title">مختبر جودة الذكاء الداخلي</h2>
        <p className="hint-text">ضع أسئلة حقيقية (سطر لكل سؤال) لقياس نسبة إصابة المحرك الداخلي.</p>
        <label className="field-label">
          <span>أسئلة الاختبار</span>
          <textarea rows={5} value={qualityCasesText} onChange={(e) => setQualityCasesText(e.target.value)} />
        </label>
        <button type="button" className="whatsapp-button" onClick={() => void runQualityLab()} disabled={qualityLoading}>
          {qualityLoading ? "جاري القياس…" : "تشغيل المختبر"}
        </button>
        {qualityResult && (
          <p className="hint-text">
            الإصابة: {qualityResult.hits}/{qualityResult.total} —{" "}
            <strong>{Math.round(qualityResult.hit_rate * 100)}%</strong>
          </p>
        )}
      </section>
    </main>
  );
}
