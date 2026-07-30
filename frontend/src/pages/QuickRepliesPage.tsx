import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  buildQuickReplyPayload,
  categoryLabel,
  downloadQuickRepliesExport,
  downloadQuickRepliesReport,
  emptyQuickReplyForm,
  formFromQuickReply,
  QUICK_REPLY_CATEGORIES,
  REPLY_VARIABLES,
  TONE_LABELS,
  type Channel,
  type Organization,
  type QuickReply,
  type QuickReplyAnalytics,
  type QuickReplyForm
} from "../lib/quickReplyHelpers";
import WhatsAppTextPreview from "../components/WhatsAppTextPreview";
import Icon from "../components/Icon";
import { toastStore } from "../stores/toast";

type ListTab = "active" | "archived";

export default function QuickRepliesPage() {
  const client = useQueryClient();
  const [listTab, setListTab] = useState<ListTab>("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [form, setForm] = useState<QuickReplyForm>(emptyQuickReplyForm());
  const [importOrgId, setImportOrgId] = useState("");
  const [seedOrgId, setSeedOrgId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const categories = useQuery({
    queryKey: ["quick-reply-categories"],
    queryFn: async () => (await api.get<string[]>("/inbox-tools/quick-replies/categories")).data
  });
  const analytics = useQuery({
    queryKey: ["quick-replies-analytics"],
    queryFn: async () => (await api.get<QuickReplyAnalytics>("/inbox-tools/quick-replies/analytics")).data
  });

  const replies = useQuery({
    queryKey: ["quick-replies", listTab, organizationFilter, categoryFilter, debouncedSearch],
    queryFn: async () => {
      const params: Record<string, string | boolean> = {};
      if (listTab === "archived") params.include_inactive = true;
      if (organizationFilter) params.organization_id = organizationFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (debouncedSearch) params.q = debouncedSearch;
      return (await api.get<QuickReply[]>("/inbox-tools/quick-replies", { params })).data;
    }
  });

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations.data ?? []) map.set(org.id, org.name);
    return map;
  }, [organizations.data]);

  const channelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of channels.data ?? []) map.set(channel.id, channel.name);
    return map;
  }, [channels.data]);

  const visibleRows = useMemo(() => {
    const rows = replies.data ?? [];
    return listTab === "archived" ? rows.filter((item) => !item.is_active) : rows.filter((item) => item.is_active);
  }, [replies.data, listTab]);

  function openCreate() {
    setEditing(null);
    setForm(emptyQuickReplyForm());
    if (organizationFilter) setForm((current) => ({ ...current, organizationId: organizationFilter }));
    setModalOpen(true);
  }

  function openEdit(item: QuickReply) {
    setEditing(item);
    setForm(formFromQuickReply(item));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyQuickReplyForm());
  }

  function insertVariable(token: string) {
    setForm((current) => ({
      ...current,
      body: current.body.trim() ? `${current.body} ${token}` : token
    }));
  }

  async function saveReply(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = buildQuickReplyPayload(form);
      if (editing) {
        await api.patch(`/inbox-tools/quick-replies/${editing.id}`, payload);
        toastStore.getState().show("تم تحديث الرد السريع.", "success");
      } else {
        await api.post("/inbox-tools/quick-replies", payload);
        toastStore.getState().show("تم حفظ الرد السريع.", "success");
      }
      closeModal();
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
      await client.invalidateQueries({ queryKey: ["quick-replies-analytics"] });
      await client.invalidateQueries({ queryKey: ["quick-reply-categories"] });
    } catch {
      toastStore.getState().show("تعذر الحفظ. تأكد من الاختصار والفرع.", "error");
    }
  }

  async function archiveReply(item: QuickReply) {
    if (!window.confirm(`أرشفة "${item.title}"؟`)) return;
    try {
      await api.delete(`/inbox-tools/quick-replies/${item.id}`);
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
      toastStore.getState().show("تمت الأرشفة.", "success");
    } catch {
      toastStore.getState().show("تعذر الأرشفة.", "error");
    }
  }

  async function restoreReply(item: QuickReply) {
    try {
      await api.patch(`/inbox-tools/quick-replies/${item.id}`, { is_active: true });
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
      toastStore.getState().show("تمت الاستعادة.", "success");
    } catch {
      toastStore.getState().show("تعذر الاستعادة.", "error");
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !importOrgId) {
      toastStore.getState().show("اختر الفرع أولاً.", "error");
      return;
    }
    try {
      const csv_content = await file.text();
      const result = await api.post("/inbox-tools/quick-replies/import", {
        organization_id: importOrgId,
        csv_content
      });
      toastStore.getState().show(
        `استيراد: ${result.data.created} جديد · ${result.data.updated} محدّث`,
        "success"
      );
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
    } catch {
      toastStore.getState().show("تعذر الاستيراد.", "error");
    } finally {
      event.target.value = "";
    }
  }

  async function seedLibrary() {
    if (!seedOrgId) {
      toastStore.getState().show("اختر الفرع.", "error");
      return;
    }
    try {
      const result = await api.post("/inbox-tools/quick-replies/seed", { organization_id: seedOrgId });
      toastStore.getState().show(
        `مكتبة جاهزة: ${result.data.created} جديد · ${result.data.skipped} موجود`,
        "success"
      );
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
    } catch {
      toastStore.getState().show("تعذر تحميل المكتبة.", "error");
    }
  }

  return (
    <main className="page quick-replies-page">
      <header className="page-header">
        <div className="page-header-row">
          <div>
            <h1>الردود السريعة</h1>
            <p>إدارة احترافية للردود — اختصارات، فئات، معاينة WhatsApp، واستخدام من صندوق الوارد.</p>
          </div>
          <button type="button" className="whatsapp-button" onClick={openCreate}>
            <Icon name="plus" /> رد جديد
          </button>
        </div>
      </header>

      <section className="stats-grid quick-replies-stats">
        <article className="metric-card"><span>إجمالي الردود</span><strong>{analytics.data?.summary?.total ?? "…"}</strong></article>
        <article className="metric-card"><span>بدون استخدام</span><strong>{analytics.data?.summary?.unused ?? "…"}</strong></article>
        <article className="metric-card"><span>إجمالي الاستخدام</span><strong>{analytics.data?.summary?.total_usage ?? "…"}</strong></article>
        {(analytics.data?.by_category ?? []).slice(0, 3).map((item) => (
          <article key={item.category} className="metric-card">
            <span>{categoryLabel(item.category)}</span>
            <strong>{item.count}</strong>
          </article>
        ))}
      </section>

      <section className="card quick-replies-analytics-card">
        <div className="quick-replies-analytics-header">
          <h2 className="section-title">تحليل الاستخدام</h2>
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={() => void downloadQuickRepliesReport("xlsx")}>
              تقرير Excel
            </button>
            <button type="button" className="secondary-button" onClick={() => void downloadQuickRepliesReport("csv")}>
              تقرير CSV
            </button>
          </div>
        </div>
        <div className="quick-replies-analytics-grid">
          <div>
            <h3 className="subsection-title">الأكثر استخداماً</h3>
            {(analytics.data?.top_used ?? []).length ? (
              <ul className="quick-replies-analytics-list">
                {(analytics.data?.top_used ?? []).slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.usage_count} · {categoryLabel(item.category)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint-text">لا توجد بيانات استخدام بعد.</p>
            )}
          </div>
          <div>
            <h3 className="subsection-title">بدون استخدام</h3>
            {(analytics.data?.unused ?? []).length ? (
              <ul className="quick-replies-analytics-list">
                {(analytics.data?.unused ?? []).slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.shortcut}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint-text">كل الردود استُخدمت على الأقل مرة.</p>
            )}
          </div>
        </div>
      </section>

      <section className="card quick-replies-list-card">
        <div className="quick-replies-toolbar">
          <div className="inline-actions quick-replies-tabs">
            <button type="button" className={listTab === "active" ? "whatsapp-button" : "secondary-button"} onClick={() => setListTab("active")}>نشطة</button>
            <button type="button" className={listTab === "archived" ? "whatsapp-button" : "secondary-button"} onClick={() => setListTab("archived")}>مؤرشفة</button>
          </div>
          <label className="field-label quick-replies-search">
            <span>بحث</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اختصار، عنوان، نص، وسوم…" />
          </label>
          <label className="field-label">
            <span>الفرع</span>
            <select value={organizationFilter} onChange={(e) => setOrganizationFilter(e.target.value)}>
              <option value="">كل الفروع</option>
              {(organizations.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            <span>الفئة</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">كل الفئات</option>
              {(categories.data ?? []).map((cat) => (
                <option key={cat} value={cat}>{categoryLabel(cat)}</option>
              ))}
            </select>
          </label>
          <p className="hint-text">{visibleRows.length} رد</p>
        </div>

        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>الاختصار</th>
                <th>العنوان</th>
                <th>الفئة</th>
                <th>الفرع</th>
                <th>الاستخدام</th>
                <th>نص الرد</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((item) => (
                <tr key={item.id}>
                  <td dir="ltr"><code>{item.shortcut}</code></td>
                  <td><strong>{item.title}</strong>{item.tags && <small className="quick-reply-tags">{item.tags}</small>}</td>
                  <td>{categoryLabel(item.category)}</td>
                  <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                  <td>{item.usage_count}</td>
                  <td className="quick-reply-body-cell">{item.body.slice(0, 80)}{item.body.length > 80 ? "…" : ""}</td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="secondary-button" onClick={() => openEdit(item)}>تعديل</button>
                      {item.is_active ? (
                        <button type="button" className="secondary-button" onClick={() => void archiveReply(item)}>أرشفة</button>
                      ) : (
                        <button type="button" className="secondary-button" onClick={() => void restoreReply(item)}>استعادة</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleRows.length && <p className="hint-text">لا توجد ردود سريعة.</p>}
        </div>
      </section>

      <section className="card quick-replies-tools-card">
        <h2 className="section-title">استيراد / تصدير / مكتبة جاهزة</h2>
        <div className="quick-replies-tools-grid">
          <div>
            <p className="hint-text">تصدير CSV — الأعمدة: shortcut · title · body · category · tags · tone_variant · sort_order</p>
            <button type="button" className="secondary-button" onClick={() => void downloadQuickRepliesExport()}>تصدير CSV</button>
          </div>
          <div>
            <label className="field-label">
              <span>استيراد إلى فرع</span>
              <select value={importOrgId} onChange={(e) => setImportOrgId(e.target.value)}>
                <option value="">اختر الفرع</option>
                {(organizations.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>ملف CSV</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => void handleImport(e)} disabled={!importOrgId} />
            </label>
          </div>
          <div>
            <label className="field-label">
              <span>مكتبة e-commerce عربية</span>
              <select value={seedOrgId} onChange={(e) => setSeedOrgId(e.target.value)}>
                <option value="">اختر الفرع</option>
                {(organizations.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <button type="button" className="whatsapp-button" onClick={() => void seedLibrary()} disabled={!seedOrgId}>
              تحميل المكتبة الجاهزة
            </button>
          </div>
        </div>
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-card quick-reply-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>{editing ? "تعديل رد سريع" : "رد سريع جديد"}</h2>
              <button type="button" className="panel-close" onClick={closeModal}>×</button>
            </header>
            <form className="stack-form" onSubmit={saveReply}>
              <div className="quick-replies-fields-row">
                <label className="field-label">
                  <span>الفرع</span>
                  <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} required>
                    <option value="">اختر الفرع</option>
                    {(organizations.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  <span>القناة (اختياري)</span>
                  <select value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })}>
                    <option value="">كل القنوات</option>
                    {(channels.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="quick-replies-fields-row">
                <label className="field-label">
                  <span>الاختصار</span>
                  <input value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder="/شحن" dir="ltr" required />
                </label>
                <label className="field-label quick-replies-field-grow">
                  <span>العنوان</span>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                </label>
              </div>
              <div className="quick-replies-fields-row">
                <label className="field-label">
                  <span>الفئة</span>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(QUICK_REPLY_CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  <span>النبرة</span>
                  <select value={form.toneVariant} onChange={(e) => setForm({ ...form, toneVariant: e.target.value })}>
                    <option value="">افتراضي</option>
                    {Object.entries(TONE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  <span>ترتيب</span>
                  <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} min={0} />
                </label>
              </div>
              <label className="field-label">
                <span>وسوم (مفصولة بفاصلة)</span>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="شحن, توصيل" />
              </label>
              <label className="field-label">
                <span>نص الرد</span>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} required />
              </label>
              <div className="quick-replies-variables">
                <span className="field-label-title">إدراج متغير</span>
                <div className="inline-actions">
                  {REPLY_VARIABLES.map((item) => (
                    <button key={item.token} type="button" className="secondary-button" onClick={() => insertVariable(item.token)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={form.isShared} onChange={(e) => setForm({ ...form, isShared: e.target.checked })} />
                <span>مشاركة مع كل الفروع</span>
              </label>
              <div className="quick-reply-preview-block">
                <span className="field-label-title">معاينة WhatsApp</span>
                <WhatsAppTextPreview text={form.body.replace(/\{\{contact\.name\}\}/g, "أحمد").replace(/\{\{contact\.phone\}\}/g, "+966501234567").replace(/\{\{contact\.email\}\}/g, "ahmad@example.com")} />
              </div>
              <div className="inline-actions">
                <button type="submit" className="whatsapp-button">{editing ? "حفظ التعديلات" : "حفظ في المكتبة"}</button>
                <button type="button" className="secondary-button" onClick={closeModal}>إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
