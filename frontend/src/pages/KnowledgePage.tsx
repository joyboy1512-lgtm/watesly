import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  CATEGORY_LABELS,
  DAY_LABELS,
  DAY_ORDER,
  downloadKnowledgeExport,
  evaluateKnowledgeQuality,
  llmStatusLabel,
  MODE_LABELS,
  normalizeBusinessHours,
  sendArticleFeedback,
  SOURCE_LABELS,
  type AgentSettings,
  type AgentSettingsPatch,
  type BusinessHoursConfig,
  type KnowledgeArticle,
  type QualityEvalResult,
  type SmartReplyResult
} from "../lib/knowledgeHelpers";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import { type WhatsAppAccountRow } from "../lib/whatsappHelpers";
import { toastStore } from "../stores/toast";

type ListTab = "active" | "inactive";

type ArticleForm = {
  title: string;
  body: string;
  category: string;
  keywords: string;
  channelId: string;
  sortOrder: string;
  language: string;
};

const emptyForm = (): ArticleForm => ({
  title: "",
  body: "",
  category: "faq",
  keywords: "",
  channelId: "",
  sortOrder: "0",
  language: "ar"
});

function formFromArticle(article: KnowledgeArticle): ArticleForm {
  return {
    title: article.title,
    body: article.body,
    category: article.category,
    keywords: article.keywords ?? "",
    channelId: article.channel_id ?? "",
    sortOrder: String(article.sort_order ?? 0),
    language: article.language || "ar"
  };
}

function buildPayload(form: ArticleForm) {
  return {
    title: form.title.trim(),
    body: form.body.trim(),
    category: form.category,
    keywords: form.keywords.trim() || null,
    channel_id: form.channelId.trim() || null,
    sort_order: Number(form.sortOrder) || 0,
    language: form.language.trim() || "ar"
  };
}

export default function KnowledgePage() {
  const client = useQueryClient();
  const [listTab, setListTab] = useState<ListTab>("active");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterChannelId, setFilterChannelId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [testChannelId, setTestChannelId] = useState("");

  const [createForm, setCreateForm] = useState<ArticleForm>(emptyForm);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [editForm, setEditForm] = useState<ArticleForm>(emptyForm);

  const [testQuery, setTestQuery] = useState("");
  const [testContactName, setTestContactName] = useState("");
  const [testMode, setTestMode] = useState<AgentSettings["default_mode"]>("kb_first");
  const [testResult, setTestResult] = useState<SmartReplyResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const [generateConversationId, setGenerateConversationId] = useState("");
  const [generateTitle, setGenerateTitle] = useState("");
  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState("");
  const [hoursDraft, setHoursDraft] = useState<BusinessHoursConfig | null>(null);
  const [hoursDirty, setHoursDirty] = useState(false);
  const [qualityCasesText, setQualityCasesText] = useState(
    "ما مدة التوصيل؟\nكم السعر؟\nكيف أرجع الطلب؟\nهل الفرع مفتوح؟"
  );
  const [qualityResult, setQualityResult] = useState<QualityEvalResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });
  const waList = whatsappAccounts.data ?? [];

  const categories = useQuery({
    queryKey: ["knowledge-categories", filterChannelId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterChannelId) params.set("channel_id", filterChannelId);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return (await api.get<string[]>(`/knowledge/categories${suffix}`)).data;
    }
  });

  const agentSettings = useQuery({
    queryKey: ["knowledge-agent-settings"],
    queryFn: async () => (await api.get<AgentSettings>("/knowledge/agent-settings")).data
  });

  useEffect(() => {
    const firstChannel = waList[0]?.channel_id;
    if (!firstChannel) return;
    setTestChannelId((current) => current || firstChannel);
    setFilterChannelId((current) => current || firstChannel);
    setCreateForm((current) => (current.channelId ? current : { ...current, channelId: firstChannel }));
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

  const listQueryKey = ["knowledge", listTab, filterCategory, filterChannelId, debouncedSearch] as const;
  const articles = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (listTab === "inactive") params.set("include_inactive", "true");
      if (filterCategory) params.set("category", filterCategory);
      if (filterChannelId) params.set("channel_id", filterChannelId);

      if (debouncedSearch) {
        params.set("q", debouncedSearch);
        params.set("limit", "100");
        return (await api.get<KnowledgeArticle[]>(`/knowledge/search?${params.toString()}`)).data;
      }

      return (await api.get<KnowledgeArticle[]>(`/knowledge?${params.toString()}`)).data;
    }
  });

  const visibleArticles = useMemo(() => {
    const rows = articles.data ?? [];
    return listTab === "inactive" ? rows.filter((item) => !item.is_active) : rows.filter((item) => item.is_active);
  }, [articles.data, listTab]);

  const sortedArticles = useMemo(() => {
    return [...visibleArticles].sort((left, right) => {
      if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
      return left.title.localeCompare(right.title, "ar");
    });
  }, [visibleArticles]);

  const categoryOptions = useMemo(() => {
    const values = new Set<string>([...(categories.data ?? []), ...Object.keys(CATEGORY_LABELS)]);
    return Array.from(values).sort((left, right) =>
      (CATEGORY_LABELS[left] ?? left).localeCompare(CATEGORY_LABELS[right] ?? right, "ar")
    );
  }, [categories.data]);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const LIST_PAGE_SIZE = 20;
  const [visibleLimit, setVisibleLimit] = useState(LIST_PAGE_SIZE);

  useEffect(() => {
    setVisibleLimit(LIST_PAGE_SIZE);
  }, [listTab, filterCategory, filterChannelId, debouncedSearch]);

  const displayedArticles = useMemo(
    () => sortedArticles.slice(0, visibleLimit),
    [sortedArticles, visibleLimit]
  );
  const hasMoreArticles = sortedArticles.length > visibleLimit;

  async function createArticle(event: FormEvent) {
    event.preventDefault();
    try {
      await api.post("/knowledge", buildPayload(createForm));
      setCreateForm(emptyForm());
      await client.invalidateQueries({ queryKey: ["knowledge"] });
      await client.invalidateQueries({ queryKey: ["knowledge-categories"] });
      toastStore.getState().show("تم حفظ المقال.", "success");
    } catch {
      toastStore.getState().show("تعذر الحفظ.", "error");
    }
  }

  function openEdit(article: KnowledgeArticle) {
    setEditingArticle(article);
    setEditForm(formFromArticle(article));
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingArticle) return;
    try {
      await api.patch(`/knowledge/${editingArticle.id}`, buildPayload(editForm));
      setEditingArticle(null);
      await client.invalidateQueries({ queryKey: ["knowledge"] });
      toastStore.getState().show("تم تحديث المقال.", "success");
    } catch {
      toastStore.getState().show("تعذر التحديث.", "error");
    }
  }

  async function archiveArticle(id: string) {
    if (!window.confirm("أرشفة المقال؟")) return;
    await api.delete(`/knowledge/${id}`);
    await client.invalidateQueries({ queryKey: ["knowledge"] });
    toastStore.getState().show("تمت الأرشفة.", "success");
  }

  async function restoreArticle(id: string) {
    await api.patch(`/knowledge/${id}`, { is_active: true });
    await client.invalidateQueries({ queryKey: ["knowledge"] });
    toastStore.getState().show("تم الاسترجاع.", "success");
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File)) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api.post<{ created: number; skipped: number }>("/knowledge/import", formData);
      event.currentTarget.reset();
      await client.invalidateQueries({ queryKey: ["knowledge"] });
      toastStore.getState().show(`تم الاستيراد: ${result.data.created} جديد، ${result.data.skipped} تخطّي.`, "success");
    } catch {
      toastStore.getState().show("تعذر الاستيراد.", "error");
    }
  }

  async function saveAgentSettings(patch: AgentSettingsPatch) {
    try {
      await api.patch("/knowledge/agent-settings", patch);
      await client.invalidateQueries({ queryKey: ["knowledge-agent-settings"] });
      toastStore.getState().show("تم حفظ إعدادات الوكيل.", "success");
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

  async function feedbackArticle(articleId: string, helpful: boolean) {
    try {
      await sendArticleFeedback(articleId, helpful);
      toastStore.getState().show(helpful ? "تم تسجيل أنه مفيد." : "تم تسجيل أنه غير مناسب.", "success");
      await client.invalidateQueries({ queryKey: ["knowledge"] });
    } catch {
      toastStore.getState().show("تعذر حفظ التقييم.", "error");
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

  async function generateFromConversation(event: FormEvent) {
    event.preventDefault();
    if (!generateConversationId.trim()) return;
    try {
      const draft = await api.post<{ title: string; body: string; category: string; keywords: string }>(
        "/knowledge/generate-from-conversation",
        { conversation_id: generateConversationId.trim(), title: generateTitle.trim() || null }
      );
      setCreateForm((current) => ({
        ...current,
        title: draft.data.title,
        body: draft.data.body,
        category: draft.data.category,
        keywords: draft.data.keywords,
        sortOrder: "0",
        language: "ar",
        channelId: current.channelId || filterChannelId || waList[0]?.channel_id || ""
      }));
      toastStore.getState().show("تم توليد مسودة FAQ — راجعها واحفظ.", "success");
    } catch {
      toastStore.getState().show("تعذر التوليد من المحادثة.", "error");
    }
  }

  function renderArticleFields(
    form: ArticleForm,
    setForm: (updater: (current: ArticleForm) => ArticleForm) => void
  ) {
    return (
      <>
        <label className="field-label">
          <span>العنوان</span>
          <input value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} required />
        </label>
        <div className="knowledge-fields-row">
          <label className="field-label">
            <span>الفئة</span>
            <select value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>ترتيب العرض</span>
            <input
              value={form.sortOrder}
              onChange={(e) => setForm((c) => ({ ...c, sortOrder: e.target.value }))}
              type="number"
              min={0}
              dir="ltr"
            />
          </label>
          <label className="field-label">
            <span>اللغة</span>
            <input value={form.language} onChange={(e) => setForm((c) => ({ ...c, language: e.target.value }))} dir="ltr" />
          </label>
        </div>
        <label className="field-label">
          <span>كلمات مفتاحية</span>
          <input
            value={form.keywords}
            onChange={(e) => setForm((c) => ({ ...c, keywords: e.target.value }))}
            placeholder="شحن، توصيل، delivery"
          />
        </label>
        <label className="field-label">
          <span>رقم واتساب (القناة)</span>
          <select
            value={form.channelId}
            onChange={(e) => setForm((c) => ({ ...c, channelId: e.target.value }))}
            required
          >
            <option value="">اختر القناة…</option>
            {waList.map((wa) => (
              <option key={wa.id} value={wa.channel_id}>
                {wa.verified_name || wa.channel_name || wa.display_phone_number}
              </option>
            ))}
          </select>
          <span className="hint-text">كل مقال يخص قناة واحدة — Travel Zone لا يرد من كتالوج/معرفة قناة أخرى.</span>
        </label>
        <label className="field-label">
          <span>المحتوى (الجواب)</span>
          <textarea value={form.body} onChange={(e) => setForm((c) => ({ ...c, body: e.target.value }))} rows={8} required />
        </label>
      </>
    );
  }

  const settings = agentSettings.data;

  return (
    <main className="page knowledge-page">
      <header className="page-header catalog-hero">
        <div>
          <span className="eyebrow whatsapp-eyebrow">AI Agent</span>
          <h1>قاعدة المعرفة</h1>
          <p>معرفة وكتالوج كل رقم واتساب منفصلان — سؤال Travel Zone لا يرد بمنتجات قناة أخرى.</p>
          {settings && (
            <div className="brand-stat-row knowledge-status-strip" aria-live="polite">
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">الوكيل</span>
                <strong className="brand-stat-value">
                  {settings.agent_enabled !== false ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">المحرك المحلي</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">اقتراح الوارد</span>
                <strong className="brand-stat-value">
                  {settings.agent_enabled !== false && settings.auto_kb_on_inbound ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">عند رسالة جديدة</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">خارجي LLM</span>
                <strong className="brand-stat-value">
                  {settings.llm_enabled && settings.llm_available ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">صقل الرد فقط</small>
              </article>
              <article className="brand-stat-card brand-stat-card--sm">
                <span className="brand-stat-label">خارج الدوام</span>
                <strong className="brand-stat-value">
                  {settings.agent_enabled !== false && settings.auto_reply_outside_hours ? "يعمل" : "متوقف"}
                </strong>
                <small className="brand-stat-meta">رد تلقائي خارج الساعات</small>
              </article>
            </div>
          )}
        </div>
      </header>

      <section className="card admin-table-card knowledge-list-card">
        <div className="admin-table-header">
          <div>
            <h2>قواعد المعرفة</h2>
            <small>{sortedArticles.length} قاعدة · مرتّبة حسب ترتيب العرض</small>
          </div>
          <button type="button" className="secondary-button" onClick={() => void downloadKnowledgeExport()}>
            تصدير CSV
          </button>
        </div>

        <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالعنوان أو الكلمات المفتاحية…"
          />
        </div>

        <div className="knowledge-filter-bar">
          <div className="catalog-filter-tabs knowledge-status-tabs">
            <button type="button" className={listTab === "active" ? "active" : ""} onClick={() => setListTab("active")}>
              نشطة
            </button>
            <button type="button" className={listTab === "inactive" ? "active" : ""} onClick={() => setListTab("inactive")}>
              مؤرشفة
            </button>
          </div>
          <label className="field-label knowledge-channel-filter">
            <span>قناة واتساب</span>
            <select value={filterChannelId} onChange={(e) => setFilterChannelId(e.target.value)}>
              <option value="">كل القنوات (عرض إداري)</option>
              {waList.map((wa) => (
                <option key={wa.id} value={wa.channel_id}>
                  {wa.verified_name || wa.channel_name || wa.display_phone_number}
                </option>
              ))}
            </select>
          </label>
          <div className="knowledge-category-tabs catalog-filter-tabs">
            <button type="button" className={filterCategory === "" ? "active" : ""} onClick={() => setFilterCategory("")}>
              كل الفئات
            </button>
            {categoryOptions.map((category) => (
              <button
                key={category}
                type="button"
                className={filterCategory === category ? "active" : ""}
                onClick={() => setFilterCategory(category)}
              >
                {CATEGORY_LABELS[category] ?? category}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-erp-table knowledge-erp-table">
            <thead className="knowledge-erp-thead-brand">
              <tr>
                <th>الترتيب</th>
                <th>العنوان</th>
                <th>القناة</th>
                <th>الفئة</th>
                <th>الجواب</th>
                <th>كلمات مفتاحية</th>
                <th>استخدام</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {articles.isLoading && (
                <tr><td colSpan={8} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!articles.isLoading && sortedArticles.length === 0 && (
                <tr><td colSpan={8} className="admin-table-empty">لا توجد قواعد مطابقة — أضف أسئلة شائعة.</td></tr>
              )}
              {!articles.isLoading && displayedArticles.map((item) => {
                const isPreviewOpen = previewId === item.id;
                const channelWa = waList.find((wa) => wa.channel_id === item.channel_id);
                const channelLabel =
                  channelWa?.verified_name
                  || channelWa?.display_phone_number
                  || (item.channel_id ? "قناة محددة" : "غير معيّن");
                return (
                  <Fragment key={item.id}>
                    <tr className={`knowledge-data-row ${item.is_active ? "" : "knowledge-row-inactive"}`}>
                      <td className="knowledge-cell-order" data-label="الترتيب">
                        <span dir="ltr">{item.sort_order}</span>
                      </td>
                      <td className="knowledge-cell-title" data-label="العنوان">
                        <div className="knowledge-title-wrap">
                          <strong className="knowledge-title-ellipsis" title={item.title}>{item.title}</strong>
                          {!item.is_active && <span className="admin-chip admin-chip-muted knowledge-archived-chip">مؤرشف</span>}
                        </div>
                      </td>
                      <td className="knowledge-cell-channel" data-label="القناة">
                        <span className="knowledge-channel-ellipsis" title={channelLabel}>
                          {channelLabel}
                        </span>
                      </td>
                      <td className="knowledge-cell-center" data-label="الفئة">
                        <span className="knowledge-category-badge">{CATEGORY_LABELS[item.category] ?? item.category}</span>
                      </td>
                      <td className="knowledge-cell-body" data-label="الجواب">
                        <span className="knowledge-body-ellipsis" title={item.body}>
                          {item.body.slice(0, 100)}{item.body.length > 100 ? "…" : ""}
                        </span>
                      </td>
                      <td className="knowledge-cell-keywords" data-label="كلمات مفتاحية">
                        <span className="knowledge-keywords-ellipsis" title={item.keywords ?? undefined}>
                          {item.keywords || "—"}
                        </span>
                      </td>
                      <td className="knowledge-cell-center" data-label="استخدام">
                        {item.usage_count > 0 || (item.helpful_count ?? 0) > 0 || (item.dismiss_count ?? 0) > 0
                          ? `${item.usage_count || 0} · ✓${item.helpful_count ?? 0} · ✗${item.dismiss_count ?? 0}`
                          : "—"}
                      </td>
                      <td className="knowledge-cell-actions" data-label="إجراءات">
                        <div className="admin-actions knowledge-row-actions">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => setPreviewId(isPreviewOpen ? null : item.id)}
                          >
                            {isPreviewOpen ? "إخفاء" : "عرض"}
                          </button>
                          <button type="button" className="secondary-button compact" onClick={() => openEdit(item)}>
                            تعديل
                          </button>
                          {item.is_active ? (
                            <button type="button" className="secondary-button compact danger-text" onClick={() => void archiveArticle(item.id)}>
                              أرشفة
                            </button>
                          ) : (
                            <button type="button" className="secondary-button compact" onClick={() => void restoreArticle(item.id)}>
                              استرجاع
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isPreviewOpen && (
                      <tr className="knowledge-preview-row">
                        <td colSpan={8}>
                          <div className="knowledge-preview-panel">
                            <div className="knowledge-preview-meta">
                              <span className="knowledge-category-badge">{CATEGORY_LABELS[item.category] ?? item.category}</span>
                              <span className="hint-text">ترتيب {item.sort_order} · {item.language}</span>
                              {item.keywords && <span className="hint-text">{item.keywords}</span>}
                            </div>
                            <p className="knowledge-preview-body">{item.body}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!articles.isLoading && hasMoreArticles && (
          <div className="knowledge-table-more">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setVisibleLimit((current) => current + LIST_PAGE_SIZE)}
            >
              إظهار المزيد ({Math.min(LIST_PAGE_SIZE, sortedArticles.length - visibleLimit)} من {sortedArticles.length - visibleLimit})
            </button>
          </div>
        )}
      </section>

      <section className="card knowledge-preview-card">
        <h2 className="section-title">تجربة AI Agent</h2>
        <p className="hint-text">الرد يُختبر على قناة واتساب محددة — لا يخلط معرفة/كتالوج القنوات الأخرى.</p>
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
                {testResult.engine ? ` · ${testResult.engine}` : ""}
              </strong>
              <WhatsAppTextPreview text={testResult.suggestion} compact />
              {(testResult.expanded_terms ?? []).length > 0 && (
                <p className="hint-text">توسيع المرادفات: {(testResult.expanded_terms ?? []).join(" · ")}</p>
              )}
            </div>
            {(testResult.matched_articles ?? []).length > 0 && (
              <div className="knowledge-matched-list">
                <h3 className="section-title-sm">مقالات مطابقة (مرتّبة بالدرجة)</h3>
                {(testResult.matched_articles ?? []).map((article) => (
                  <article key={article.id} className="inbox-kb-card">
                    <strong>
                      {article.title}
                      {article.score != null && (
                        <span className="hint-text"> · درجة {Math.round(article.score * 100)}%</span>
                      )}
                    </strong>
                    {article.body && <p>{article.body.slice(0, 120)}…</p>}
                    {(article.reasons ?? []).length > 0 && (
                      <p className="hint-text">{(article.reasons ?? []).join(" · ")}</p>
                    )}
                    <div className="catalog-card-actions">
                      <button type="button" className="secondary-button compact" onClick={() => void feedbackArticle(article.id, true)}>
                        مفيد
                      </button>
                      <button type="button" className="secondary-button compact" onClick={() => void feedbackArticle(article.id, false)}>
                        غير مناسب
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {(testResult.matched_products ?? []).length > 0 && (
              <div className="knowledge-matched-list">
                <h3 className="section-title-sm">
                  {testResult.needs_clarification ? "خيارات للتوضيح مع العميل" : "منتجات مطابقة"}
                </h3>
                {(testResult.matched_products ?? []).map((product) => (
                  <p key={product.id} className="hint-text">
                    {product.clarify_option ? `${product.clarify_option}) ` : ""}
                    {product.name} — {product.price_label}
                    {product.score != null ? ` · درجة ${Math.round(product.score * 100)}%` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card knowledge-preview-card">
        <h2 className="section-title">مختبر جودة الذكاء الداخلي</h2>
        <p className="hint-text">ضع أسئلة حقيقية (سطر لكل سؤال) لقياس نسبة إصابة المحرك الداخلي بدون LLM.</p>
        <label className="field-label">
          <span>أسئلة الاختبار</span>
          <textarea
            rows={5}
            value={qualityCasesText}
            onChange={(e) => setQualityCasesText(e.target.value)}
            placeholder={"ما مدة التوصيل؟\nكم السعر؟"}
          />
        </label>
        <button type="button" className="whatsapp-button" onClick={() => void runQualityLab()} disabled={qualityLoading}>
          {qualityLoading ? "جاري القياس…" : "تشغيل المختبر"}
        </button>
        {qualityResult && (
          <div className="knowledge-preview-layout">
            <p className="hint-text">
              الإصابة: {qualityResult.hits}/{qualityResult.total} —{" "}
              <strong>{Math.round(qualityResult.hit_rate * 100)}%</strong>
            </p>
            <div className="knowledge-matched-list">
              {qualityResult.results.map((row) => (
                <article key={`${row.index}-${row.query}`} className="inbox-kb-card">
                  <strong>
                    {row.matched ? "✓" : "✗"} {row.query}
                  </strong>
                  <p className="hint-text">
                    الأعلى: {row.top_title ?? "—"}
                    {row.top_score != null ? ` · درجة ${Math.round(row.top_score * 100)}%` : ""}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card knowledge-agent-card knowledge-panel-shell">
        <div className="knowledge-panel-intro">
          <span className="knowledge-panel-kicker">التحكم</span>
          <h2 className="section-title">لوحة تحكم الذكاء</h2>
          <p className="hint-text">أقسام مفصولة بألوان الموقع — شغّل أو أوقف كل جزء بوضوح.</p>
        </div>
        {settings && (() => {
          const agentOn = settings.agent_enabled !== false;
          const inboundOn = agentOn && settings.auto_kb_on_inbound;
          const outsideOn = agentOn && Boolean(settings.auto_reply_outside_hours);
          const llmOn = Boolean(settings.llm_enabled && settings.llm_available);
          return (
            <div className="agent-control-panel">
              <div className={`agent-power-bar ${agentOn ? "is-on" : "is-off"}`}>
                <div className="agent-power-copy">
                  <span className="agent-power-eyebrow">الحالة العامة للوكيل</span>
                  <strong>{agentOn ? "يعمل الآن" : "متوقف"}</strong>
                  <p>
                    {agentOn
                      ? "الاقتراحات والردود الآلية مفعّلة حسب الأقسام أدناه."
                      : "كل الآلي متوقف. زر AI في المحادثة يبقى للاختبار اليدوي فقط."}
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

              <div className="agent-section-grid">
                <article className="agent-section-card accent-internal">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>1</span>
                      <div>
                        <h3>الذكاء الداخلي</h3>
                        <p>قاعدة المعرفة + الكتالوج + المطابقة العربية/الإنجليزية بدون مفتاح خارجي.</p>
                      </div>
                    </div>
                    <span className={`agent-state-badge ${agentOn ? "is-on" : "is-off"}`}>
                      {agentOn ? "مفعّل" : "متوقف مع الوكيل"}
                    </span>
                  </header>
                  <div className="knowledge-fields-row">
                    <label className="field-label">
                      <span>وضع الرد للمحادثات</span>
                      <select
                        value={settings.default_mode}
                        disabled={!agentOn}
                        onChange={(e) => void saveAgentSettings({ default_mode: e.target.value as AgentSettings["default_mode"] })}
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

                <article className="agent-section-card accent-inbound">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>2</span>
                      <div>
                        <h3>اقتراح عند رسالة واردة</h3>
                        <p>
                          عندما يكتب العميل رسالة جديدة، يظهر للموظف في الوارد اقتراح رد جاهز (لا يُرسل تلقائيًا).
                          الموظف يختار: استخدام / غير مناسب / تجاهل.
                        </p>
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
                  <p className="agent-section-note">
                    هذا ليس ردًا آليًا للعميل — هو مساعدة للموظف فقط داخل الشاشة.
                  </p>
                </article>

                <article className="agent-section-card accent-external">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>3</span>
                      <div>
                        <h3>الذكاء الخارجي (LLM)</h3>
                        <p>يصقل صياغة الرد بعد تجهيزه من المعرفة/الكتالوج. يحتاج مفتاح API.</p>
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
                  <p className="hint-text">الحالة: {llmStatusLabel(settings)}</p>
                  <div className="knowledge-fields-row">
                    <label className="field-label">
                      <span>مفتاح API</span>
                      <input
                        type="password"
                        value={llmApiKeyDraft}
                        onChange={(e) => setLlmApiKeyDraft(e.target.value)}
                        placeholder={settings.llm_key_configured ? "•••••••• (محفوظ — اكتب جديدًا للاستبدال)" : "sk-..."}
                        dir="ltr"
                        autoComplete="off"
                      />
                    </label>
                    <label className="field-label">
                      <span>Base URL</span>
                      <input
                        value={settings.llm_api_base_url ?? ""}
                        onBlur={(e) => void saveAgentSettings({ llm_api_base_url: e.target.value.trim() || null })}
                        placeholder="https://api.openai.com/v1"
                        dir="ltr"
                      />
                    </label>
                    <label className="field-label">
                      <span>النموذج</span>
                      <input
                        value={settings.llm_model ?? ""}
                        onBlur={(e) => void saveAgentSettings({ llm_model: e.target.value.trim() || null })}
                        placeholder="gpt-4o-mini"
                        dir="ltr"
                      />
                    </label>
                  </div>
                  <div className="catalog-card-actions">
                    <button type="button" className="whatsapp-button" onClick={() => void saveLlmApiKey()} disabled={!llmApiKeyDraft.trim()}>
                      حفظ المفتاح
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void clearLlmApiKey()}
                      disabled={!settings.llm_key_configured}
                    >
                      حذف المفتاح
                    </button>
                  </div>
                  <label className="field-label">
                    <span>تعليمات النظام للـ LLM</span>
                    <textarea
                      value={settings.llm_system_prompt ?? ""}
                      onBlur={(e) => void saveAgentSettings({ llm_system_prompt: e.target.value || null })}
                      rows={3}
                      placeholder="مثال: أجب باختصار باللهجة الكويتية، ولا تخترع أسعارًا…"
                      disabled={!agentOn}
                    />
                  </label>
                </article>

                <article className="agent-section-card accent-hours">
                  <header className="agent-section-head">
                    <div className="agent-section-title-row">
                      <span className="agent-section-index" aria-hidden>4</span>
                      <div>
                        <h3>خارج الدوام</h3>
                        <p>
                          إذا راسل العميل خارج ساعات العمل ولم يُرد أحد بعد، يُرسل النظام رسالة واحدة تلقائيًا ثم يتوقف.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`agent-state-toggle ${outsideOn ? "is-on" : "is-off"}`}
                      disabled={!agentOn}
                      onClick={() => void saveAgentSettings({ auto_reply_outside_hours: !settings.auto_reply_outside_hours })}
                    >
                      {outsideOn ? "يعمل" : "متوقف"}
                    </button>
                  </header>
                  <p className="agent-section-note">
                    الآن: {settings.within_business_hours ? "داخل الدوام" : "خارج الدوام"}
                    {outsideOn ? " — الرد الآلي جاهز خارج الساعات." : " — لن يُرسل ردًا تلقائيًا."}
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
                    <h4 className="section-title-sm">ساعات العمل</h4>
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
                      <button type="button" className="whatsapp-button" onClick={() => void saveBusinessHours()} disabled={!hoursDirty || !agentOn}>
                        حفظ ساعات العمل
                      </button>
                      {hoursDirty && <span className="hint-text">هناك تعديلات غير محفوظة</span>}
                    </div>
                  </div>
                </article>
              </div>
            </div>
          );
        })()}
      </section>

      <section className="card catalog-manage-card knowledge-panel-shell knowledge-tools-shell">
        <div className="knowledge-panel-intro">
          <span className="knowledge-panel-kicker">المحتوى</span>
          <h2 className="section-title">إضافة واستيراد</h2>
          <p className="hint-text">نفس ترتيب الأقسام وألوان الموقع — أضف يدويًا أو استورد أو ولّد من محادثة.</p>
        </div>
        <div className="agent-section-grid knowledge-tools-grid">
          <form className="agent-section-card accent-create stack-form" onSubmit={(e) => void createArticle(e)}>
            <header className="agent-section-head">
              <div className="agent-section-title-row">
                <span className="agent-section-index" aria-hidden>1</span>
                <div>
                  <h3>إضافة مقال</h3>
                  <p>أنشئ سؤالًا وجوابًا جديدًا لقاعدة المعرفة.</p>
                </div>
              </div>
              <span className="agent-section-tag">يدوي</span>
            </header>
            {renderArticleFields(createForm, setCreateForm)}
            <button type="submit" className="whatsapp-button">حفظ المقال</button>
          </form>

          <form className="agent-section-card accent-import stack-form" onSubmit={(e) => void importCsv(e)}>
            <header className="agent-section-head">
              <div className="agent-section-title-row">
                <span className="agent-section-index" aria-hidden>2</span>
                <div>
                  <h3>استيراد CSV</h3>
                  <p>ارفع ملفًا جاهزًا لإضافة عدة مقالات دفعة واحدة.</p>
                </div>
              </div>
              <span className="agent-section-tag">دفعة</span>
            </header>
            <label className="field-label">
              <span>ملف CSV</span>
              <input name="file" type="file" accept=".csv,text/csv" required />
            </label>
            <p className="agent-section-note">الأعمدة: title · body · category · keywords · channel_id · sort_order · language</p>
            <button type="submit" className="whatsapp-button">استيراد المقالات</button>
          </form>

          <form className="agent-section-card accent-generate stack-form" onSubmit={(e) => void generateFromConversation(e)}>
            <header className="agent-section-head">
              <div className="agent-section-title-row">
                <span className="agent-section-index" aria-hidden>3</span>
                <div>
                  <h3>توليد FAQ من محادثة</h3>
                  <p>استخرج مسودة سؤال وجواب من محادثة موجودة في الوارد.</p>
                </div>
              </div>
              <span className="agent-section-tag">تلقائي</span>
            </header>
            <label className="field-label">
              <span>معرّف المحادثة</span>
              <input
                value={generateConversationId}
                onChange={(e) => setGenerateConversationId(e.target.value)}
                placeholder="UUID من Inbox"
                dir="ltr"
              />
            </label>
            <label className="field-label">
              <span>عنوان (اختياري)</span>
              <input value={generateTitle} onChange={(e) => setGenerateTitle(e.target.value)} />
            </label>
            <button type="submit" className="whatsapp-button" disabled={!generateConversationId.trim()}>
              توليد مسودة
            </button>
          </form>
        </div>
      </section>

      {editingArticle && (
        <div className="catalog-edit-overlay" role="dialog" aria-modal="true">
          <button type="button" className="catalog-edit-backdrop" aria-label="إغلاق" onClick={() => setEditingArticle(null)} />
          <form className="catalog-edit-panel stack-form" onSubmit={(e) => void saveEdit(e)}>
            <div className="catalog-edit-head">
              <h3>تعديل: {editingArticle.title}</h3>
              <button type="button" className="panel-close" onClick={() => setEditingArticle(null)}>×</button>
            </div>
            {renderArticleFields(editForm, setEditForm)}
            <div className="catalog-card-actions">
              <button type="submit" className="whatsapp-button">حفظ التعديلات</button>
              <button type="button" className="secondary-button" onClick={() => setEditingArticle(null)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
