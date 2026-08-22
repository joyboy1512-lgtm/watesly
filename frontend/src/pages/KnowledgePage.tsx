import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  CATEGORY_LABELS,
  downloadKnowledgeExport,
  MODE_LABELS,
  SOURCE_LABELS,
  type AgentSettings,
  type KnowledgeArticle,
  type SmartReplyResult
} from "../lib/knowledgeHelpers";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import { toastStore } from "../stores/toast";

type ListTab = "active" | "inactive";

type ArticleForm = {
  title: string;
  body: string;
  category: string;
  keywords: string;
  sortOrder: string;
  language: string;
};

const emptyForm = (): ArticleForm => ({
  title: "",
  body: "",
  category: "faq",
  keywords: "",
  sortOrder: "0",
  language: "ar"
});

function formFromArticle(article: KnowledgeArticle): ArticleForm {
  return {
    title: article.title,
    body: article.body,
    category: article.category,
    keywords: article.keywords ?? "",
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
    sort_order: Number(form.sortOrder) || 0,
    language: form.language.trim() || "ar"
  };
}

export default function KnowledgePage() {
  const client = useQueryClient();
  const [listTab, setListTab] = useState<ListTab>("active");
  const [filterCategory, setFilterCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

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

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const categories = useQuery({
    queryKey: ["knowledge-categories"],
    queryFn: async () => (await api.get<string[]>("/knowledge/categories")).data
  });

  const agentSettings = useQuery({
    queryKey: ["knowledge-agent-settings"],
    queryFn: async () => (await api.get<AgentSettings>("/knowledge/agent-settings")).data
  });

  useEffect(() => {
    if (agentSettings.data?.default_mode) {
      setTestMode(agentSettings.data.default_mode);
    }
  }, [agentSettings.data?.default_mode]);

  const listQueryKey = ["knowledge", listTab, filterCategory, debouncedSearch] as const;
  const articles = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (listTab === "inactive") params.set("include_inactive", "true");
      if (filterCategory) params.set("category", filterCategory);

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

  async function saveAgentSettings(patch: Partial<AgentSettings>) {
    try {
      await api.patch("/knowledge/agent-settings", patch);
      await client.invalidateQueries({ queryKey: ["knowledge-agent-settings"] });
      toastStore.getState().show("تم حفظ إعدادات الوكيل.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ الإعدادات.", "error");
    }
  }

  async function testAi() {
    if (!testQuery.trim()) return;
    setTestLoading(true);
    try {
      const result = await api.post<SmartReplyResult>("/knowledge/suggest-reply", {
        query: testQuery.trim(),
        contact_name: testContactName.trim(),
        mode: testMode
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
      setCreateForm({
        title: draft.data.title,
        body: draft.data.body,
        category: draft.data.category,
        keywords: draft.data.keywords,
        sortOrder: "0",
        language: "ar"
      });
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
          <p>قواعد FAQ مرتّبة أفقياً للرد التلقائي في Inbox — KB → كatalog → AI محلي مع LLM اختياري.</p>
          {settings && (
            <p className="hint-text">
              LLM: {settings.llm_available ? (settings.llm_enabled ? "مفعّل" : "متاح — غير مفعّل") : "غير متاح (أضف AI_API_KEY)"}
              {" · "}
              الوضع الافتراضي: {MODE_LABELS[settings.default_mode] ?? settings.default_mode}
            </p>
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
            <thead>
              <tr>
                <th>الترتيب</th>
                <th>العنوان</th>
                <th>الفئة</th>
                <th>الجواب</th>
                <th>كلمات مفتاحية</th>
                <th>استخدام</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {articles.isLoading && (
                <tr><td colSpan={7} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!articles.isLoading && sortedArticles.length === 0 && (
                <tr><td colSpan={7} className="admin-table-empty">لا توجد قواعد مطابقة — أضف أسئلة شائعة.</td></tr>
              )}
              {!articles.isLoading && sortedArticles.map((item) => {
                const isPreviewOpen = previewId === item.id;
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
                        {item.usage_count > 0 ? item.usage_count : "—"}
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
                        <td colSpan={7}>
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
      </section>

      <section className="card knowledge-preview-card">
        <h2 className="section-title">تجربة AI Agent</h2>
        <p className="hint-text">اكتب سؤالاً وشاهد الرد مع مصدره والمقالات المطابقة.</p>
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
            {(testResult.matched_articles ?? []).length > 0 && (
              <div className="knowledge-matched-list">
                <h3 className="section-title-sm">مقالات مطابقة</h3>
                {(testResult.matched_articles ?? []).map((article) => (
                  <article key={article.id} className="inbox-kb-card">
                    <strong>{article.title}</strong>
                    {article.body && <p>{article.body.slice(0, 120)}…</p>}
                  </article>
                ))}
              </div>
            )}
            {(testResult.matched_products ?? []).length > 0 && (
              <div className="knowledge-matched-list">
                <h3 className="section-title-sm">منتجات مطابقة</h3>
                {(testResult.matched_products ?? []).map((product) => (
                  <p key={product.id} className="hint-text">{product.name} — {product.price_label}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card knowledge-agent-card">
        <h2 className="section-title">سياسات الوكيل الذكي</h2>
        <p className="hint-text">تُطبَّق على Inbox الوارد والاقتراحات التلقائية.</p>
        {settings && (
          <div className="knowledge-agent-grid">
            <label className="field-label">
              <span>الوضع الافتراضي</span>
              <select
                value={settings.default_mode}
                onChange={(e) => void saveAgentSettings({ default_mode: e.target.value as AgentSettings["default_mode"] })}
              >
                {Object.entries(MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>النبرة</span>
              <select value={settings.tone} onChange={(e) => void saveAgentSettings({ tone: e.target.value as AgentSettings["tone"] })}>
                <option value="friendly">ودّية</option>
                <option value="formal">رسمية</option>
                <option value="concise">مختصرة</option>
              </select>
            </label>
            <label className="field-label">
              <span>اللغة</span>
              <input
                value={settings.language}
                onChange={(e) => void saveAgentSettings({ language: e.target.value })}
                dir="ltr"
              />
            </label>
            <label className="field-label checkbox-row">
              <input
                type="checkbox"
                checked={settings.llm_enabled}
                disabled={!settings.llm_available}
                onChange={(e) => void saveAgentSettings({ llm_enabled: e.target.checked })}
              />
              <span>تفعيل LLM {settings.llm_available ? "" : "(يتطلب AI_API_KEY)"}</span>
            </label>
            <label className="field-label checkbox-row">
              <input
                type="checkbox"
                checked={settings.auto_kb_on_inbound}
                onChange={(e) => void saveAgentSettings({ auto_kb_on_inbound: e.target.checked })}
              />
              <span>اقتراح تلقائي عند رسالة واردة</span>
            </label>
            <label className="field-label checkbox-row">
              <input
                type="checkbox"
                checked={settings.auto_reply_outside_hours ?? false}
                onChange={(e) => void saveAgentSettings({ auto_reply_outside_hours: e.target.checked })}
              />
              <span>رد تلقائي خارج ساعات العمل (أول رسالة)</span>
            </label>
            <label className="field-label knowledge-field-full">
              <span>رسالة خارج الدوام</span>
              <textarea
                value={settings.outside_hours_message ?? ""}
                onBlur={(e) => void saveAgentSettings({ outside_hours_message: e.target.value || null })}
                rows={2}
                placeholder="شكراً لتواصلك. نحن خارج ساعات العمل…"
              />
            </label>
            <p className="hint-text knowledge-field-full">
              ساعات العمل الافتراضية: الأحد–الخميس 09:00–18:00 (Asia/Kuwait). يمكن تخصيصها عبر API.
            </p>
            <label className="field-label knowledge-field-full">
              <span>تعليمات النظام (LLM)</span>
              <textarea
                value={settings.llm_system_prompt ?? ""}
                onBlur={(e) => void saveAgentSettings({ llm_system_prompt: e.target.value || null })}
                rows={3}
                placeholder="تعليمات إضافية للنموذج…"
              />
            </label>
          </div>
        )}
      </section>

      <section className="card catalog-manage-card">
        <h2 className="section-title">إضافة واستيراد</h2>
        <div className="catalog-actions-grid">
          <form className="catalog-panel stack-form" onSubmit={(e) => void createArticle(e)}>
            <h3>إضافة مقال</h3>
            {renderArticleFields(createForm, setCreateForm)}
            <button type="submit" className="whatsapp-button">حفظ المقال</button>
          </form>

          <form className="catalog-panel stack-form" onSubmit={(e) => void importCsv(e)}>
            <h3>استيراد CSV</h3>
            <label className="field-label">
              <span>ملف CSV</span>
              <input name="file" type="file" accept=".csv,text/csv" required />
            </label>
            <p className="hint-text">الأعمدة: title · body · category · keywords · sort_order · language</p>
            <button type="submit">استيراد المقالات</button>
          </form>

          <form className="catalog-panel stack-form" onSubmit={(e) => void generateFromConversation(e)}>
            <h3>توليد FAQ من محادثة</h3>
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
            <button type="submit" disabled={!generateConversationId.trim()}>توليد مسودة</button>
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
