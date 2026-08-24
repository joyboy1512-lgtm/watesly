import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { refreshContactsAfterMutation, downloadContactsImportTemplate, type Channel, type Organization } from "../lib/contactHelpers";
import { toastStore } from "../stores/toast";

export default function ContactImportPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });

  const orgChannels = useMemo(
    () => (channels.data ?? []).filter((item) => !organizationId || item.organization_id === organizationId),
    [channels.data, organizationId]
  );

  function onOrganizationChange(value: string) {
    setOrganizationId(value);
    setChannelId("");
  }

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !channelId) {
      toastStore.getState().show("اختر الفرع والقناة أولاً.", "error");
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set("organization_id", organizationId);
    form.set("channel_id", channelId);
    setUploading(true);
    try {
      const result = await api.post<{ created: number; existing: number; skipped: number; invalid?: number }>(
        "/contacts/import",
        form,
        { headers: { "Content-Type": "multipart/form-data" }, timeout: 300000 }
      );
      const { created, existing, skipped, invalid = 0 } = result.data;
      toastStore.getState().show(
        `تم الاستيراد: ${created} جديد، ${existing} موجود مسبقاً، ${skipped} فارغ، ${invalid} رقم غير صالح.`,
        "success"
      );
      await refreshContactsAfterMutation(client);
      navigate("/contacts", { replace: true, state: { fromCreate: true } });
    } catch (error) {
      const message =
        typeof error === "object" && error !== null && "response" in error
          ? String((error as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "")
          : "";
      toastStore.getState().show(
        message.includes("10 MB") || message.includes("كبير")
          ? message
          : message.includes("صيغة") || message.includes("format")
            ? "صيغة الملف غير مدعومة. استخدم Excel (.xlsx) أو CSV."
            : message || "تعذر استيراد الملف. تأكد من الأعمدة: phone, name, language",
        "error"
      );
    } finally {
      setUploading(false);
    }
  }

  const ready = Boolean(organizationId && channelId && fileName);

  return (
    <main className="page contacts-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/contacts" className="contacts-back-link">← العملاء</Link>
            <h1>رفع عملاء — Excel / CSV</h1>
          </div>
          <div className="contacts-form-topbar-actions">
            <button type="submit" form="contact-import-form" className="contacts-erp-btn contacts-erp-btn-primary" disabled={!ready || uploading}>
              {uploading ? "جاري الرفع…" : "رفع واستيراد"}
            </button>
            <Link to="/contacts" className="contacts-erp-btn">إلغاء</Link>
          </div>
        </header>

        <form id="contact-import-form" className="contacts-form-grid contacts-import-form" onSubmit={(e) => void importFile(e)}>
          <div className="contacts-form-section">
            <h2>الفرع والقناة</h2>
            <label className="field-label">
              <span>الفرع</span>
              <select value={organizationId} onChange={(e) => onOrganizationChange(e.target.value)} required>
                <option value="">اختر الفرع</option>
                {(organizations.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>القناة</span>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!organizationId} required>
                <option value="">اختر القناة</option>
                {orgChannels.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="contacts-form-section contacts-import-drop">
            <h2>ملف Excel</h2>
            <label className="field-label">
              <span>اختر الملف</span>
              <input
                name="file"
                type="file"
                accept=".xlsx,.xlsm,.csv,text/csv"
                required
                disabled={!organizationId || !channelId || uploading}
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </label>
            {fileName && <p className="hint-text">الملف: {fileName}</p>}
            <p className="hint-text">
              الأعمدة: <strong dir="ltr">phone</strong> (إلزامي) · <strong dir="ltr">name</strong> · <strong dir="ltr">language</strong> (ar/en) · <strong dir="ltr">email</strong>
            </p>
            <button
              type="button"
              className="contacts-erp-btn"
              onClick={() => void downloadContactsImportTemplate().catch(() => toastStore.getState().show("تعذر تحميل القالب.", "error"))}
            >
              تحميل قالب Excel
            </button>
            <p className="hint-text">الأرقام المكررة تُحدَّث تلقائياً بدلاً من إنشاء سجل جديد.</p>
          </div>
        </form>
      </section>
    </main>
  );
}
