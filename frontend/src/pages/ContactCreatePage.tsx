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
  LIFECYCLE_OPTIONS,
  refreshContactsAfterMutation,
  tagChipColor,
  type Channel,
  type Contact,
  type Organization,
  type Tag
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
  const [lifecycleStage, setLifecycleStage] = useState("lead");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: async () => (await api.get<Tag[]>("/inbox-tools/tags")).data
  });

  const orgChannels = useMemo(
    () => (channels.data ?? []).filter((item) => !organizationId || item.organization_id === organizationId),
    [channels.data, organizationId]
  );
  const orgTags = useMemo(
    () => (tags.data ?? []).filter((item) => !organizationId || item.organization_id === organizationId),
    [tags.data, organizationId]
  );

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    );
  }

  async function createTag() {
    if (!organizationId || !newTagName.trim()) {
      toastStore.getState().show("اختر الفرع وأدخل اسم الوسم.", "error");
      return;
    }
    const response = await api.post<Tag>("/inbox-tools/tags", {
      organization_id: organizationId,
      name: newTagName.trim()
    });
    setNewTagName("");
    await client.invalidateQueries({ queryKey: ["tags"] });
    setSelectedTagIds((current) => [...current, response.data.id]);
    toastStore.getState().show("تم إنشاء الوسم.", "success");
  }

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
    setSelectedTagIds([]);
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
          countryCode,
          lifecycleStage,
          tagIds: selectedTagIds
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
            <h2>التصنيف والشرائح</h2>
            <p className="hint-text">
              الشرائح تُبنى من الفلاتر (الفرع، الوسم، المرحلة). عيّن الوسوم والمرحلة هنا ليدخل العميل الشرائح المطابقة.
              لإنشاء شريحة جديدة: صفحة العملاء → زر <strong>الشرائح</strong>.
            </p>
            <label className="field-label">
              <span>مرحلة العميل</span>
              <select value={lifecycleStage} onChange={(e) => setLifecycleStage(e.target.value)}>
                {LIFECYCLE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="field-label">
              <span>الوسوم (اختياري)</span>
              {!organizationId && <p className="hint-text">اختر الفرع أولاً لعرض الوسوم.</p>}
              {organizationId && (
                <div className="contacts-tags-cell">
                  {orgTags.length === 0 && <p className="hint-text">لا توجد وسوم لهذا الفرع.</p>}
                  {orgTags.map((tag) => {
                    const active = selectedTagIds.includes(tag.id);
                    const colors = tagChipColor(tag.name);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`contacts-tag-chip ${active ? "contacts-tag-chip-active" : ""}`}
                        style={active ? { background: colors.bg, color: colors.text, borderColor: colors.border } : undefined}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {organizationId && (
              <div className="contacts-inline-tag-create">
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="وسم جديد…"
                />
                <button type="button" className="contacts-erp-btn" disabled={!newTagName.trim()} onClick={() => void createTag()}>
                  + وسم
                </button>
              </div>
            )}
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
