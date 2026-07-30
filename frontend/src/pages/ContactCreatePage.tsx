import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  buildContactCreatePayload,
  formatGenderLabel,
  inferGenderPreview,
  isCountryCodeValid,
  isOptionalEmailValid,
  refreshContactsAfterMutation,
  type Channel,
  type Contact,
  type Organization
} from "../lib/contactHelpers";
import { toastStore } from "../stores/toast";

export default function ContactCreatePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);

  const [organizationId, setOrganizationId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState("ar");
  const [countryCode, setCountryCode] = useState("KW");

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

  useEffect(() => {
    const orgs = organizations.data ?? [];
    if (!organizationId && orgs.length === 1) setOrganizationId(orgs[0].id);
  }, [organizations.data, organizationId]);

  useEffect(() => {
    if (!organizationId || channelId) return;
    if (orgChannels.length === 1) setChannelId(orgChannels[0].id);
  }, [organizationId, channelId, orgChannels]);

  function onOrganizationChange(value: string) {
    setOrganizationId(value);
    setChannelId("");
  }

  async function createContact(event: FormEvent) {
    event.preventDefault();
    if (!isOptionalEmailValid(email)) {
      toastStore.getState().show("البريد الإلكتروني غير صالح.", "error");
      return;
    }
    if (!isCountryCodeValid(countryCode)) {
      toastStore.getState().show("رمز الدولة يجب أن يكون حرفين (مثل KW).", "error");
      return;
    }

    setSaving(true);
    try {
      const response = await api.post<Contact>(
        "/contacts",
        buildContactCreatePayload({
          organizationId,
          channelId,
          phone,
          name,
          email,
          language,
          countryCode
        })
      );
      await refreshContactsAfterMutation(client, response.data);
      toastStore.getState().show("تم إنشاء العميل.", "success");
      navigate("/contacts", { replace: true, state: { fromCreate: true } });
    } catch {
      // API errors are surfaced by the axios interceptor via formatApiError.
    } finally {
      setSaving(false);
    }
  }

  const ready = Boolean(
    organizationId &&
    channelId &&
    phone.trim() &&
    name.trim() &&
    isOptionalEmailValid(email) &&
    isCountryCodeValid(countryCode)
  );

  const genderPreview = inferGenderPreview(name);

  return (
    <main className="page contacts-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/contacts" className="contacts-back-link">← العملاء</Link>
            <h1>إنشاء عميل جديد</h1>
          </div>
          <div className="contacts-form-topbar-actions">
            <button type="submit" form="contact-create-form" className="contacts-erp-btn contacts-erp-btn-primary" disabled={!ready || saving}>
              {saving ? "جاري الحفظ…" : "حفظ"}
            </button>
            <Link to="/contacts" className="contacts-erp-btn">إلغاء</Link>
          </div>
        </header>

        <form id="contact-create-form" className="contacts-form-grid" noValidate onSubmit={(e) => void createContact(e)}>
          <div className="contacts-form-section">
            <h2>بيانات التواصل</h2>
            <label className="field-label">
              <span>رقم WhatsApp</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+96550000000" dir="ltr" required />
            </label>
            <label className="field-label">
              <span>اسم العميل</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل" required />
            </label>
            {name.trim() && (
              <p className="contacts-gender-preview">
                الجنس (تقديري): <strong>{formatGenderLabel(genderPreview)}</strong>
              </p>
            )}
            <label className="field-label">
              <span>البريد الإلكتروني (اختياري)</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" type="text" dir="ltr" inputMode="email" autoComplete="email" />
            </label>
          </div>

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

          <div className="contacts-form-section">
            <h2>تفضيلات</h2>
            <label className="field-label">
              <span>اللغة</span>
              <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="ar" dir="ltr" />
            </label>
            <label className="field-label">
              <span>رمز الدولة</span>
              <input value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} placeholder="KW" maxLength={2} dir="ltr" />
            </label>
          </div>
        </form>
      </section>
    </main>
  );
}
