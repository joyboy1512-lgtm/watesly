import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  CATEGORY_LABELS,
  downloadKnowledgeExport,
  type KnowledgeArticle
} from "../lib/knowledgeHelpers";
import { Link } from "react-router-dom";
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
  const [createForm, setCreateForm] = useState<ArticleForm>(emptyForm);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [editForm, setEditForm] = useState<ArticleForm>(emptyForm);

  const [generateConversationId, setGenerateConversationId] = useState("");
  const [generateTitle, setGenerateTitle] = useState("");
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

  const knowledgeStats = useQuery({
    queryKey: ["knowledge", "stats"],
    queryFn: async () => {
      const rows = (await api.get<KnowledgeArticle[]>("/knowledge?include_inactive=true")).data;
      return {
        active: rows.filter((item) => item.is_active).length,
        archived: rows.filter((item) => !item.is_active).length,
        total: rows.length
      };
    }
  });

  useEffect(() => {
    const firstChannel = waList[0]?.channel_id;
    if (!firstChannel) return;
    setFilterChannelId((current) => current || firstChannel);
    setCreateForm((current) => (current.channelId ? current : { ...current, channelId: firstChannel }));
  }, [waList]);

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const LIST_PAGE_SIZE = 20;
  const [visibleLimit, setVisibleLimit] = useState(LIST_PAGE_SIZE);

  useEffect(() => {
    setVisibleLimit(LIST_PAGE_SIZE);
    setSelectedIds(new Set());
  }, [listTab, filterCategory, filterChannelId, debouncedSearch]);

  const displayedArticles = useMemo(
    () => sortedArticles.slice(0, visibleLimit),
    [sortedArticles, visibleLimit]
  );
  const hasMoreArticles = sortedArticles.length > visibleLimit;
  const displayedIds = useMemo(() => displayedArticles.map((item) => item.id), [displayedArticles]);
  const selectedCount = selectedIds.size;
  const allDisplayedSelected =
    displayedIds.length > 0 && displayedIds.every((id) => selectedIds.has(id));
  const someDisplayedSelected = displayedIds.some((id) => selectedIds.has(id));

  function toggleRowSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllDisplayed() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allDisplayedSelected) {
        for (const id of displayedIds) next.delete(id);
      } else {
        for (const id of displayedIds) next.add(id);
      }
      return next;
    });
  }

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
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    toastStore.getState().show("تمت الأرشفة.", "success");
  }

  async function restoreArticle(id: string) {
    await api.patch(`/knowledge/${id}`, { is_active: true });
    await client.invalidateQueries({ queryKey: ["knowledge"] });
    toastStore.getState().show("تم الاسترجاع.", "success");
  }

  async function deleteArticle(id: string) {
    if (!window.confirm("حذف القاعدة نهائياً؟ لا يمكن التراجع.")) return;
    await api.delete(`/knowledge/${id}?permanent=true`);
    await client.invalidateQueries({ queryKey: ["knowledge"] });
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    toastStore.getState().show("تم الحذف.", "success");
  }

  async function bulkArchiveSelected() {
    if (selectedCount === 0) return;
    if (!window.confirm(`أرشفة ${selectedCount} قاعدة محددة؟`)) return;
    setBulkBusy(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/knowledge/bulk-archive", {
        article_ids: [...selectedIds]
      });
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["knowledge"] });
      toastStore.getState().show(
        `تمت أرشفة ${result.data.succeeded}${result.data.failed ? ` · فشل ${result.data.failed}` : ""}`,
        "success"
      );
    } catch {
      toastStore.getState().show("تعذرت الأرشفة الجماعية.", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDeleteSelected() {
    if (selectedCount === 0) return;
    if (!window.confirm(`حذف ${selectedCount} قاعدة نهائياً؟ لا يمكن التراجع.`)) return;
    setBulkBusy(true);
    try {
      const result = await api.post<{ succeeded: number; failed: number }>("/knowledge/bulk-delete", {
        article_ids: [...selectedIds]
      });
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["knowledge"] });
      toastStore.getState().show(
        `تم حذف ${result.data.succeeded}${result.data.failed ? ` · فشل ${result.data.failed}` : ""}`,
        "success"
      );
    } catch {
      toastStore.getState().show("تعذر الحذف الجماعي.", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkRestoreSelected() {
    if (selectedCount === 0) return;
    setBulkBusy(true);
    try {
      let succeeded = 0;
      for (const id of selectedIds) {
        await api.patch(`/knowledge/${id}`, { is_active: true });
        succeeded += 1;
      }
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["knowledge"] });
      toastStore.getState().show(`تم استرجاع ${succeeded}`, "success");
    } catch {
      toastStore.getState().show("تعذر الاسترجاع الجماعي.", "error");
    } finally {
      setBulkBusy(false);
    }
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

  return (
    <main className="page knowledge-page">
      <header className="page-header catalog-hero">
        <div>
          <span className="eyebrow whatsapp-eyebrow">Knowledge</span>
          <h1>قاعدة المعرفة</h1>
          <p>
            قواعد الرد لكل قناة واتساب — إعدادات الذكاء نُقلت إلى صفحة{" "}
            <Link to="/ai">الذكاء الاصطناعي</Link>.
          </p>
          <div className="brand-stat-row knowledge-status-strip" aria-live="polite">
            <article className="brand-stat-card brand-stat-card--sm">
              <span className="brand-stat-label">القنوات</span>
              <strong className="brand-stat-value">{waList.length}</strong>
              <small className="brand-stat-meta">واتساب مربوطة</small>
            </article>
            <article className="brand-stat-card brand-stat-card--sm">
              <span className="brand-stat-label">قواعد نشطة</span>
              <strong className="brand-stat-value">{knowledgeStats.data?.active ?? "—"}</strong>
              <small className="brand-stat-meta">جاهزة للرد</small>
            </article>
            <article className="brand-stat-card brand-stat-card--sm">
              <span className="brand-stat-label">قواعد مؤرشفة</span>
              <strong className="brand-stat-value">{knowledgeStats.data?.archived ?? "—"}</strong>
              <small className="brand-stat-meta">غير مستخدمة</small>
            </article>
            <article className="brand-stat-card brand-stat-card--sm">
              <span className="brand-stat-label">إجمالي القواعد</span>
              <strong className="brand-stat-value">{knowledgeStats.data?.total ?? "—"}</strong>
              <small className="brand-stat-meta">نشطة + مؤرشفة</small>
            </article>
          </div>
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

        <div className="knowledge-table-controls">
          <div className="catalog-filter-tabs knowledge-status-tabs">
            <button type="button" className={listTab === "active" ? "active" : ""} onClick={() => setListTab("active")}>
              نشطة
            </button>
            <button type="button" className={listTab === "inactive" ? "active" : ""} onClick={() => setListTab("inactive")}>
              مؤرشفة
            </button>
          </div>
          <label className="knowledge-channel-filter-compact">
            <span>قناة واتساب</span>
            <select value={filterChannelId} onChange={(e) => setFilterChannelId(e.target.value)}>
              <option value="">كل القنوات</option>
              {waList.map((wa) => (
                <option key={wa.id} value={wa.channel_id}>
                  {wa.verified_name || wa.channel_name || wa.display_phone_number}
                </option>
              ))}
            </select>
          </label>
          <label className="knowledge-channel-filter-compact knowledge-mobile-only-control">
            <span>الفئة</span>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label="تصفية الفئة">
              <option value="">كل الفئات</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category] ?? category}
                </option>
              ))}
            </select>
          </label>
          <label className="knowledge-mobile-select-all knowledge-mobile-only-control">
            <input
              type="checkbox"
              checked={allDisplayedSelected}
              ref={(el) => {
                if (el) el.indeterminate = someDisplayedSelected && !allDisplayedSelected;
              }}
              onChange={toggleAllDisplayed}
              aria-label="تحديد الكل الظاهر"
            />
            <span>تحديد الكل الظاهر</span>
          </label>
        </div>

        {selectedCount > 0 && (
          <div className="knowledge-bulk-bar" role="toolbar" aria-label="إجراءات جماعية">
            <span>محدد: {selectedCount}</span>
            {listTab === "active" ? (
              <button type="button" className="secondary-button compact" disabled={bulkBusy} onClick={() => void bulkArchiveSelected()}>
                أرشفة المحدد
              </button>
            ) : (
              <button type="button" className="secondary-button compact" disabled={bulkBusy} onClick={() => void bulkRestoreSelected()}>
                استرجاع المحدد
              </button>
            )}
            <button type="button" className="secondary-button compact danger-text" disabled={bulkBusy} onClick={() => void bulkDeleteSelected()}>
              حذف المحدد
            </button>
            <button type="button" className="secondary-button compact" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>
              إلغاء التحديد
            </button>
          </div>
        )}

        <div className="admin-table-wrap">
          <table className="admin-erp-table knowledge-erp-table">
            <thead className="knowledge-erp-thead-brand">
              <tr>
                <th className="knowledge-th-check">
                  <input
                    type="checkbox"
                    checked={allDisplayedSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someDisplayedSelected && !allDisplayedSelected;
                    }}
                    onChange={toggleAllDisplayed}
                    aria-label="تحديد الكل"
                  />
                </th>
                <th>الترتيب</th>
                <th>العنوان</th>
                <th>
                  <div className="knowledge-th-filter">
                    <span>القناة</span>
                    <select
                      value={filterChannelId}
                      onChange={(e) => setFilterChannelId(e.target.value)}
                      aria-label="تصفية القناة"
                    >
                      <option value="">الكل</option>
                      {waList.map((wa) => (
                        <option key={wa.id} value={wa.channel_id}>
                          {wa.verified_name || wa.channel_name || wa.display_phone_number}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
                <th>
                  <div className="knowledge-th-filter">
                    <span>الفئة</span>
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      aria-label="تصفية الفئة"
                    >
                      <option value="">الكل</option>
                      {categoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category] ?? category}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
                <th>الجواب</th>
                <th>كلمات مفتاحية</th>
                <th>استخدام</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {articles.isLoading && (
                <tr><td colSpan={9} className="admin-table-empty">جاري التحميل…</td></tr>
              )}
              {!articles.isLoading && sortedArticles.length === 0 && (
                <tr><td colSpan={9} className="admin-table-empty">لا توجد قواعد مطابقة — أضف أسئلة شائعة.</td></tr>
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
                      <td className="knowledge-cell-check" data-label="تحديد">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleRowSelection(item.id)}
                          aria-label={`تحديد ${item.title}`}
                        />
                      </td>
                      <td className="knowledge-cell-order" data-label="الترتيب">
                        <span dir="ltr">{item.sort_order}</span>
                      </td>
                      <td className="knowledge-cell-title" data-label="العنوان">
                        <div className="knowledge-title-wrap">
                          <strong className="knowledge-title-ellipsis" title={item.title}>{item.title}</strong>
                          {!item.is_active && <span className="admin-chip admin-chip-muted knowledge-archived-chip">مؤرشف</span>}
                        </div>
                      </td>
                      <td
                        className="knowledge-cell-channel"
                        data-label="القناة / الفئة"
                        data-category={CATEGORY_LABELS[item.category] ?? item.category}
                      >
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
                            <button type="button" className="secondary-button compact" onClick={() => void archiveArticle(item.id)}>
                              أرشفة
                            </button>
                          ) : (
                            <button type="button" className="secondary-button compact" onClick={() => void restoreArticle(item.id)}>
                              استرجاع
                            </button>
                          )}
                          <button type="button" className="secondary-button compact danger-text" onClick={() => void deleteArticle(item.id)}>
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isPreviewOpen && (
                      <tr className="knowledge-preview-row">
                        <td colSpan={9}>
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
