import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import WhatsAppTemplatePreview from "../components/WhatsAppTemplatePreview";
import {
  buildStoredComponents,
  getTemplateHeaderInfo,
  HEADER_FORMAT_LABELS,
  HEADER_MEDIA_ACCEPT,
  type TemplateComponent,
  type TemplateHeaderFormat
} from "../lib/templateMedia";
import { uploadFile, type UploadedFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";

type WhatsAppAccount = { id: string; display_phone_number: string; verified_name: string | null };
type Template = {
  id: string;
  whatsapp_account_id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body_text: string | null;
  components: TemplateComponent[] | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  paused: "موقوف",
  disabled: "معطّل"
};

const CATEGORY_LABELS: Record<string, string> = {
  marketing: "تسويق",
  utility: "خدمات",
  authentication: "تحقق"
};

export default function TemplatesPage() {
  const client = useQueryClient();
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
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<Template[]>("/templates")).data
  });

  const filtered = (templates.data ?? []).filter((item) => {
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      item.name.toLowerCase().includes(term) ||
      (item.body_text ?? "").toLowerCase().includes(term);
    const matchesStatus = !statusFilter || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const previewComponents = useMemo(
    () => buildStoredComponents(bodyText, headerFile, headerType || null),
    [bodyText, headerFile, headerType]
  );

  function accountDisplayName(accountIdValue: string) {
    const account = (accounts.data ?? []).find((item) => item.id === accountIdValue);
    return account?.verified_name || account?.display_phone_number || "نشاطك التجاري";
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
        <h1>قوالب WhatsApp</h1>
        <p>إدارة قوالب الرسائل المعتمدة من Meta — للحملات والأتمتة.</p>
      </header>

      <section className="card templates-list-card">
        <div className="templates-toolbar">
          <label className="field-label templates-search">
            <span>بحث</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم أو نص القالب…" />
          </label>
          <label className="field-label templates-filter">
            <span>الحالة</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <p className="hint-text">{filtered.length} قالب</p>
        </div>

        <form className="templates-sync-row" onSubmit={sync}>
          <label className="field-label">
            <span>مزامنة من Meta</span>
            <select value={syncAccountId} onChange={(e) => setSyncAccountId(e.target.value)}>
              <option value="">اختر حساب WhatsApp</option>
              {(accounts.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.verified_name || item.display_phone_number}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary-button">مزامنة القوالب</button>
        </form>

        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>اللغة</th>
                <th>الفئة</th>
                <th>الحالة</th>
                <th>الرأس (وسائط)</th>
                <th>نص القالب</th>
                <th>معاينة</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const header = getTemplateHeaderInfo(item.components);
                return (
                <tr key={item.id}>
                  <td dir="ltr"><strong>{item.name}</strong></td>
                  <td>{item.language}</td>
                  <td>{CATEGORY_LABELS[item.category] ?? item.category}</td>
                  <td><span className="tag-chip">{STATUS_LABELS[item.status] ?? item.status}</span></td>
                  <td>{header ? HEADER_FORMAT_LABELS[header.format] : "—"}</td>
                  <td className="template-body-cell">{item.body_text || "—"}</td>
                  <td>
                    <div className="templates-table-actions">
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setPreviewTemplate(item)}
                      >
                        معاينة
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
              );})}
            </tbody>
          </table>
          {!filtered.length && <p className="hint-text">لا توجد قوالب.</p>}
        </div>
      </section>

      <section className="card templates-manage-card">
        <h2 className="section-title">إضافة قالب</h2>
        <p className="hint-text">للاختبار المحلي. القوالب الحقيقية تُعتمد من Meta ثم تُزامَن.</p>

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
              {headerFile && (
                <p className="hint-text">✓ {headerFile.filename}</p>
              )}
              <p className="hint-text">الصوت غير مدعوم في رأس القالب — استخدمه في المحادثة أو الأتمتة.</p>
            </label>
          )}

          <button type="submit" className="whatsapp-button" disabled={uploadingHeader}>حفظ القالب</button>
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
              businessName={previewBusinessName}
              templateName={previewTemplate.name}
            />
          </div>
        </div>
      )}
    </main>
  );
}
