import { ChangeEvent, FormEvent, Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import {
  buildStoredComponents,
  HEADER_MEDIA_ACCEPT,
  type TemplateComponent,
  type TemplateHeaderFormat
} from "../lib/templateMedia";
import {
  computeTemplateStats,
  formatTemplateCategory,
  formatTemplateHeader,
  formatTemplateStatus,
  templateCategoryBadgeClass,
  templateStatusBadgeClass,
  truncateTemplateBody,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_STATUS_LABELS
} from "../lib/templateHelpers";
import { uploadFile, type UploadedFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";

type WhatsAppAccount = {
  id: string;
  display_phone_number: string;
  verified_name: string | null;
  channel_name?: string | null;
};
type Template = {
  id: string;
  whatsapp_account_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  body_text: string | null;
  components: TemplateComponent[] | null;
};

type PageTab = "list" | "create" | "sync";

export default function TemplatesPage() {
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<PageTab>("list");

  const [accountId, setAccountId] = useState("");
  const [syncAccountId, setSyncAccountId] = useState("");
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [language, setLanguage] = useState("ar");
  const [category, setCategory] = useState("marketing");
  const [templateStatus, setTemplateStatus] = useState("draft");
  const [headerType, setHeaderType] = useState<TemplateHeaderFormat | "">("");
  const [headerFile, setHeaderFile] = useState<UploadedFile | null>(null);
  const [uploadingHeader, setUploadingHeader] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<Template[]>("/templates")).data
  });

  const accountMap = useMemo(
    () => new Map(
      (accounts.data ?? []).map((item) => [
        item.id,
        item.verified_name || item.display_phone_number
      ])
    ),
    [accounts.data]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (templates.data ?? []).filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!term) return true;
      const haystack = `${item.name} ${item.body_text ?? ""} ${accountMap.get(item.whatsapp_account_id) ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [templates.data, search, statusFilter, categoryFilter, accountMap]);

  const stats = useMemo(() => computeTemplateStats(templates.data ?? []), [templates.data]);

  const previewComponents = useMemo(
    () => buildStoredComponents(bodyText, headerFile, headerType || null),
    [bodyText, headerFile, headerType]
  );

  function accountDisplayName(accountIdValue: string) {
    return accountMap.get(accountIdValue) ?? "نشاطك التجاري";
  }

  const previewBusinessName = previewTemplate
    ? accountDisplayName(previewTemplate.whatsapp_account_id)
    : accountDisplayName(accountId);

  async function onHeaderFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingHeader(true);
    try {
      const uploaded = await uploadFile(file);
      setHeaderFile(uploaded);
      toastStore.getState().show("تم رفع الملف.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الملف.", "error");
      event.target.value = "";
    } finally {
      setUploadingHeader(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (headerType && !headerFile) {
      toastStore.getState().show("ارفع ملفاً للرأس (صورة / فيديو / PDF).", "error");
      return;
    }
    try {
      const components = buildStoredComponents(bodyText, headerFile, headerType || null);
      await api.post("/templates", {
        whatsapp_account_id: accountId,
        name,
        language,
        category,
        status: templateStatus,
        body_text: bodyText || null,
        components
      });
      setName("");
      setBodyText("");
      setHeaderType("");
      setHeaderFile(null);
      await client.invalidateQueries({ queryKey: ["templates"] });
      setActiveTab("list");
      toastStore.getState().show("تم حفظ القالب.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ القالب.", "error");
    }
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm("حذف هذا القالب؟")) return;
    try {
      await api.delete(`/templates/${id}`);
      await client.invalidateQueries({ queryKey: ["templates"] });
      if (expandedId === id) setExpandedId(null);
      toastStore.getState().show("تم حذف القالب.", "success");
    } catch {
      toastStore.getState().show("تعذر حذف القالب.", "error");
    }
  }

  async function sync(event: FormEvent) {
    event.preventDefault();
    if (!syncAccountId) {
      toastStore.getState().show("اختر حساب WhatsApp للمزامنة.", "error");
      return;
    }
    try {
      const result = await api.post(`/templates/sync/${syncAccountId}`);
      await client.invalidateQueries({ queryKey: ["templates"] });
      setActiveTab("list");
      toastStore.getState().show(
        `تمت المزامنة: ${result.data.created} جديد، ${result.data.updated} محدّث.`,
        "success"
      );
    } catch {
      toastStore.getState().show("تعذر المزامنة. تحقق من ربط Meta.", "error");
    }
  }

  return (
    <main className="page templates-page">
      <header className="page-header">
        <div>
          <span className="eyebrow whatsapp-eyebrow">WhatsApp Business API</span>
          <h1>قوالب WhatsApp</h1>
          <p>جدول موحّد لكل قالب — الحالة، الفئة، الحساب، والمعاينة في صف واحد.</p>
        </div>
        <Link to="/campaigns" className="secondary-button">الحملات ←</Link>
      </header>

      <section className="admin-stats-row admin-stats-row-brand">
        <article className="admin-stat-card admin-stat-card-brand">
          <span>إجمالي القوالب</span>
          <strong>{stats.total}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>معتمدة</span>
          <strong>{stats.approved}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>قيد المراجعة</span>
          <strong>{stats.pending}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>مرفوضة</span>
          <strong>{stats.rejected}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>تسويق</span>
          <strong>{stats.marketing}</strong>
        </article>
      </section>

      <div className="templates-page-tabs">
        <button
          type="button"
          className={activeTab === "list" ? "templates-tab active" : "templates-tab"}
          onClick={() => setActiveTab("list")}
        >
          جدول القوالب
        </button>
        <button
          type="button"
          className={activeTab === "create" ? "templates-tab active" : "templates-tab"}
          onClick={() => setActiveTab("create")}
        >
          إنشاء قالب
        </button>
        <button
          type="button"
          className={activeTab === "sync" ? "templates-tab active" : "templates-tab"}
          onClick={() => setActiveTab("sync")}
        >
          مزامنة Meta
        </button>
      </div>

      {activeTab === "list" && (
        <section className="card admin-table-card">
          <div className="admin-table-header">
            <div>
              <h2>جدول القوالب</h2>
              <small>{filtered.length} قالب · معتمدة للحملات والأتمتة</small>
            </div>
          </div>

          <div className="admin-toolbar" style={{ padding: "12px 16px 0" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو النص أو الحساب…"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">كل الحالات</option>
              {Object.entries(TEMPLATE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">كل الفئات</option>
              {Object.entries(TEMPLATE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {templates.isLoading && <p className="hint-text" style={{ padding: "12px 16px" }}>جاري تحميل القوالب…</p>}
          {templates.isError && <p className="hint-text" style={{ padding: "12px 16px" }}>تعذر تحميل القوالب.</p>}

          {!templates.isLoading && !templates.isError && (
            <div className="admin-table-wrap">
              <table className="admin-erp-table templates-erp-table">
                <thead>
                  <tr>
                    <th>القالب</th>
                    <th>حساب WhatsApp</th>
                    <th>اللغة</th>
                    <th>الفئة</th>
                    <th>الحالة</th>
                    <th>الرأس</th>
                    <th>نص القالب</th>
                    <th>Meta ID</th>
                    <th>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="admin-table-empty">
                        لا توجد قوالب. أنشئ قالباً أو زامِن من Meta.
                      </td>
                    </tr>
                  )}
                  {filtered.map((item) => {
                    const isExpanded = expandedId === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr>
                          <td>
                            <div className="admin-cell-main">
                              <strong dir="ltr">{item.name}</strong>
                            </div>
                          </td>
                          <td>
                            <div className="admin-cell-stack">
                              <strong dir="ltr">{accountMap.get(item.whatsapp_account_id) ?? "—"}</strong>
                            </div>
                          </td>
                          <td>{item.language}</td>
                          <td>
                            <span className={templateCategoryBadgeClass(item.category)}>
                              {formatTemplateCategory(item.category)}
                            </span>
                          </td>
                          <td>
                            <span className={templateStatusBadgeClass(item.status)}>
                              {formatTemplateStatus(item.status)}
                            </span>
                          </td>
                          <td>{formatTemplateHeader(item.components)}</td>
                          <td className="template-body-cell">{truncateTemplateBody(item.body_text)}</td>
                          <td>
                            {item.meta_template_id ? (
                              <code dir="ltr" title={item.meta_template_id}>
                                {item.meta_template_id.length > 14
                                  ? `${item.meta_template_id.slice(0, 10)}…`
                                  : item.meta_template_id}
                              </code>
                            ) : (
                              <span className="admin-chip admin-chip-muted">محلي</span>
                            )}
                          </td>
                          <td>
                            <div className="admin-actions templates-row-actions">
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                              >
                                {isExpanded ? "إخفاء" : "معاينة"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => setPreviewTemplate(item)}
                              >
                                نافذة
                              </button>
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => void deleteTemplate(item.id)}
                              >
                                حذف
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="templates-expand-row">
                            <td colSpan={9}>
                              <div className="templates-expand-panel">
                                <WhatsAppTemplatePreview
                                  bodyText={item.body_text}
                                  components={item.components}
                                  businessName={accountDisplayName(item.whatsapp_account_id)}
                                  templateName={item.name}
                                />
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
          )}
        </section>
      )}

      {activeTab === "create" && (
        <section className="card templates-manage-card">
          <div className="admin-table-header">
            <div>
              <h2>إنشاء قالب</h2>
              <small>للاختبار المحلي — القوالب الحقيقية تُعتمد من Meta ثم تُزامَن</small>
            </div>
          </div>

          <div className="templates-editor-layout">
            <form className="templates-panel stack-form" onSubmit={create}>
              <label className="field-label">
                <span>حساب WhatsApp</span>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="">اختر الحساب</option>
                  {(accounts.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.verified_name || item.display_phone_number}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                <span>اسم القالب</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="welcome_message"
                  dir="ltr"
                  required
                />
              </label>

              <div className="templates-fields-row">
                <label className="field-label">
                  <span>اللغة</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="ar">العربية (ar)</option>
                    <option value="en">English (en)</option>
                  </select>
                </label>
                <label className="field-label">
                  <span>الفئة</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="marketing">تسويق</option>
                    <option value="utility">خدمات</option>
                    <option value="authentication">تحقق</option>
                  </select>
                </label>
                <label className="field-label">
                  <span>الحالة</span>
                  <select value={templateStatus} onChange={(e) => setTemplateStatus(e.target.value)}>
                    <option value="draft">مسودة</option>
                    <option value="approved">معتمد (محلي)</option>
                    <option value="pending">قيد المراجعة</option>
                  </select>
                </label>
              </div>

              <label className="field-label">
                <span>نص القالب</span>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="مرحباً {{1}}! شكراً لتواصلك معنا."
                  rows={5}
                />
              </label>
              <p className="hint-text">استخدم {"{{1}}"}، {"{{2}}"} للمتغيرات كما في Meta.</p>

              <label className="field-label">
                <span>رأس القالب (وسائط — اختياري)</span>
                <select
                  value={headerType}
                  onChange={(e) => {
                    const value = e.target.value as TemplateHeaderFormat | "";
                    setHeaderType(value);
                    if (!value) setHeaderFile(null);
                  }}
                >
                  <option value="">بدون وسائط</option>
                  <option value="IMAGE">صورة</option>
                  <option value="VIDEO">فيديو</option>
                  <option value="DOCUMENT">PDF / مستند</option>
                </select>
              </label>
              {headerType && (
                <label className="field-label">
                  <span>ملف الرأس</span>
                  <input
                    type="file"
                    accept={HEADER_MEDIA_ACCEPT}
                    onChange={(e) => void onHeaderFileChange(e)}
                    disabled={uploadingHeader}
                  />
                  {headerFile && <p className="hint-text">✓ {headerFile.filename}</p>}
                  <p className="hint-text">الصوت غير مدعوم في رأس القالب — استخدمه في المحادثة أو الأتمتة.</p>
                </label>
              )}

              <button type="submit" className="whatsapp-button" disabled={uploadingHeader}>
                حفظ القالب
              </button>
            </form>

            <div className="templates-preview-sticky">
              <WhatsAppTemplatePreview
                bodyText={bodyText}
                components={previewComponents}
                businessName={previewBusinessName}
                templateName={name || undefined}
              />
            </div>
          </div>
        </section>
      )}

      {activeTab === "sync" && (
        <section className="card admin-table-card">
          <div className="admin-table-header">
            <div>
              <h2>مزامنة من Meta</h2>
              <small>اسحب القوالب المعتمدة من WhatsApp Business Manager</small>
            </div>
          </div>

          <form className="templates-sync-panel stack-form" onSubmit={sync}>
            <p className="hint-text">
              اختر حساب WhatsApp مربوطاً بـ Meta، ثم اضغط مزامنة لتحديث جدول القوالب بالحالات الرسمية.
            </p>
            <label className="field-label">
              <span>حساب WhatsApp</span>
              <select value={syncAccountId} onChange={(e) => setSyncAccountId(e.target.value)} required>
                <option value="">اختر حساب WhatsApp</option>
                {(accounts.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.verified_name || item.display_phone_number}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="whatsapp-button">مزامنة القوالب</button>
          </form>
        </section>
      )}

      {previewTemplate && (
        <div
          className="template-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="معاينة القالب"
          onClick={() => setPreviewTemplate(null)}
        >
          <div className="template-preview-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="template-preview-dialog-header">
              <h3>معاينة القالب</h3>
              <button type="button" className="secondary-button compact" onClick={() => setPreviewTemplate(null)}>
                إغلاق
              </button>
            </div>
            <WhatsAppTemplatePreview
              bodyText={previewTemplate.body_text}
              components={previewTemplate.components}
              businessName={accountDisplayName(previewTemplate.whatsapp_account_id)}
              templateName={previewTemplate.name}
            />
          </div>
        </div>
      )}
    </main>
  );
}
