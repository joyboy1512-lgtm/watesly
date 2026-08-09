import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  contactDisplayLabel,
  contactInitials,
  exportContactGdprJson,
  formatContactDate,
  formatGenderLabel,
  formatGenderSalutation,
  formatLifecycleStage,
  LIFECYCLE_LABELS,
  openContactConversation,
  refreshContactsAfterMutation,
  tagChipColor,
  type Channel,
  type Contact,
  type ContactActivity,
  type ContactCustomFieldValue,
  type Organization,
  type Tag
} from "../lib/contactHelpers";
import { STAGE_LABELS, formatDealAmount, type Deal } from "../lib/crmHelpers";
import { interestGenderHint, type InterestCategory } from "../lib/interestHelpers";
import { toastStore } from "../stores/toast";

type CustomFieldDef = { id: string; field_key: string; label: string; field_type: string };

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messaging, setMessaging] = useState(false);

  const contact = useQuery({
    queryKey: ["contact", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<Contact>(`/contacts/${id}`)).data
  });

  const activity = useQuery({
    queryKey: ["contact-activity", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<ContactActivity>(`/contacts/${id}/activity`)).data
  });

  const tags = useQuery({
    queryKey: ["contact-tags", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<Tag[]>(`/contacts/${id}/tags`)).data
  });

  const allTags = useQuery({
    queryKey: ["tags"],
    queryFn: async () => (await api.get<Tag[]>("/inbox-tools/tags")).data
  });

  const contactInterests = useQuery({
    queryKey: ["contact-interests", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<InterestCategory[]>(`/contacts/${id}/interests`)).data
  });

  const allInterests = useQuery({
    queryKey: ["interests"],
    queryFn: async () => (await api.get<InterestCategory[]>("/platform/interests")).data
  });

  const customFieldValues = useQuery({
    queryKey: ["contact-custom-fields", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<ContactCustomFieldValue[]>(`/contacts/${id}/custom-fields`)).data
  });

  const contactDeals = useQuery({
    queryKey: ["contact-deals", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<Deal[]>("/platform/crm/deals", { params: { contact_id: id } })).data
  });

  const customFieldDefs = useQuery({
    queryKey: ["custom-fields"],
    queryFn: async () => (await api.get<CustomFieldDef[]>("/platform/custom-fields")).data
  });

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });

  const orgName = useMemo(
    () => (organizations.data ?? []).find((o) => o.id === contact.data?.organization_id)?.name ?? "—",
    [organizations.data, contact.data?.organization_id]
  );

  const channelName = useMemo(
    () => (channels.data ?? []).find((c) => c.id === contact.data?.channel_id)?.name ?? "—",
    [channels.data, contact.data?.channel_id]
  );

  const fieldLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const field of customFieldDefs.data ?? []) map.set(field.id, field.label);
    return map;
  }, [customFieldDefs.data]);

  async function handleDelete() {
    if (!id || !window.confirm("حذف هذا العميل؟")) return;
    try {
      await api.delete(`/contacts/${id}`);
      await client.invalidateQueries({ queryKey: ["contacts"] });
      toastStore.getState().show("تم حذف العميل.", "success");
      navigate("/contacts");
    } catch {
      toastStore.getState().show("تعذر حذف العميل.", "error");
    }
  }

  async function handleOpenInbox() {
    const convId = activity.data?.primary_conversation_id;
    if (convId) {
      navigate(`/inbox?conversation=${convId}`);
      return;
    }
    if (!id) return;
    setMessaging(true);
    try {
      const conversationId = await openContactConversation(id);
      navigate(`/inbox?conversation=${conversationId}`);
    } catch {
      toastStore.getState().show("تعذر فتح المحادثة.", "error");
    } finally {
      setMessaging(false);
    }
  }

  async function handleMessage() {
    if (!id) return;
    setMessaging(true);
    try {
      const conversationId = await openContactConversation(id);
      navigate(`/inbox?conversation=${conversationId}`);
    } catch {
      toastStore.getState().show("تعذر بدء المحادثة.", "error");
    } finally {
      setMessaging(false);
    }
  }

  async function handleExportData() {
    if (!id) return;
    try {
      await exportContactGdprJson(id, contact.data?.display_name);
      toastStore.getState().show("تم تصدير بيانات العميل.", "success");
    } catch {
      toastStore.getState().show("تعذر تصدير البيانات.", "error");
    }
  }

  if (contact.isLoading) {
    return (
      <main className="page contacts-page contacts-erp-page">
        <section className="contacts-erp-shell contacts-detail-shell">
          <div className="contacts-erp-loading">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="contacts-erp-skeleton-row" />
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (contact.isError || !contact.data) {
    return (
      <main className="page contacts-page contacts-erp-page">
        <section className="contacts-erp-shell contacts-detail-shell">
          <div className="contacts-erp-empty">
            <strong>العميل غير موجود</strong>
            <Link to="/contacts" className="contacts-erp-btn">العودة للقائمة</Link>
          </div>
        </section>
      </main>
    );
  }

  const item = contact.data;
  const act = activity.data;
  const displayLabel = contactDisplayLabel(item);

  return (
    <main className="page contacts-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-detail-shell">
        <header className="contacts-detail-header">
          <div className="contacts-detail-identity">
            <Link to="/contacts" className="contacts-erp-btn contacts-erp-btn-ghost contacts-detail-back">← العملاء</Link>
            <span className="contacts-avatar contacts-detail-avatar">
              {contactInitials(item.display_name, item.external_address)}
            </span>
            <div>
              <span className="contacts-erp-eyebrow">ملف العميل</span>
              <h1>{displayLabel}</h1>
              <p className="contacts-detail-subtitle" dir="ltr">{item.external_address}</p>
            </div>
          </div>
          <div className="contacts-erp-actions">
            <button type="button" className="contacts-erp-btn contacts-erp-btn-primary" disabled={messaging} onClick={() => void handleMessage()}>
              {messaging ? "…" : "رسالة"}
            </button>
            <button type="button" className="contacts-erp-btn" disabled={messaging} onClick={() => void handleOpenInbox()}>
              فتح صندوق الوارد
            </button>
            <button type="button" className="contacts-erp-btn" onClick={() => setEditOpen(true)}>تعديل</button>
            <Link to={`/crm/new?contact_id=${id}`} className="contacts-erp-btn contacts-action-link">صفقة CRM</Link>
            <button type="button" className="contacts-erp-btn" onClick={() => void handleExportData()}>تصدير بياناتي</button>
            <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" onClick={() => void handleDelete()}>حذف</button>
          </div>
        </header>

        <div className="contacts-detail-grid">
          <section className="contacts-detail-panel">
            <h2>البيانات الأساسية</h2>
            <dl className="contacts-detail-dl">
              <div><dt>الاسم</dt><dd>{item.display_name || "—"}</dd></div>
              <div><dt>الهاتف</dt><dd dir="ltr">{item.external_address}</dd></div>
              <div><dt>البريد</dt><dd dir="ltr">{item.email || "—"}</dd></div>
              <div><dt>الجنس</dt><dd>{formatGenderLabel(item.gender)} ({formatGenderSalutation(item.gender)})</dd></div>
              <div><dt>الفرع</dt><dd>{orgName}</dd></div>
              <div><dt>القناة</dt><dd>{channelName}</dd></div>
              <div><dt>اللغة</dt><dd>{item.language || "—"}</dd></div>
              <div><dt>رمز الدولة</dt><dd>{item.country_code || "—"}</dd></div>
              <div>
                <dt>مرحلة العميل</dt>
                <dd>{formatLifecycleStage(item.lifecycle_stage)}</dd>
              </div>
              {(item.utm_source || item.utm_campaign) && (
                <div>
                  <dt>مصدر CTWA</dt>
                  <dd>{item.utm_source}{item.utm_campaign ? ` · ${item.utm_campaign}` : ""}</dd>
                </div>
              )}
              <div>
                <dt>موافقة التسويق</dt>
                <dd>{item.marketing_opt_in === false ? "غير موافق" : "موافق"}</dd>
              </div>
              <div>
                <dt>محظور</dt>
                <dd>{act?.is_blocked ? "نعم" : "لا"}</dd>
              </div>
              <div><dt>تاريخ الإضافة</dt><dd>{formatContactDate(item.created_at)}</dd></div>
              <div><dt>آخر تحديث</dt><dd>{item.updated_at ? formatContactDate(item.updated_at) : "—"}</dd></div>
            </dl>
          </section>

          <section className="contacts-detail-panel">
            <h2>اهتمامات العميل</h2>
            <p className="hint-text">تُستخدم لتوجيه الحملات واستبعاد فئات غير مناسبة (مثل تجميل للرجال).</p>
            <ContactInterestsEditor
              contactId={id!}
              assigned={(contactInterests.data ?? []).map((item) => item.id)}
              options={allInterests.data ?? []}
              onSaved={() => void client.invalidateQueries({ queryKey: ["contact-interests", id] })}
            />
          </section>

          <section className="contacts-detail-panel">
            <h2>الوسوم</h2>
            <div className="contacts-tags-cell">
              {(tags.data ?? []).length === 0 && <p className="hint-text">لا توجد وسوم</p>}
              {(tags.data ?? []).map((tag) => {
                const colors = tagChipColor(tag.name);
                return (
                  <span
                    key={tag.id}
                    className="contacts-tag-chip"
                    style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
                  >
                    {tag.name}
                  </span>
                );
              })}
            </div>
          </section>

          <section className="contacts-detail-panel">
            <h2>صفقات CRM ({contactDeals.data?.length ?? 0})</h2>
            {(contactDeals.data ?? []).length === 0 && <p className="hint-text">لا توجد صفقات</p>}
            <ul className="contacts-mini-list">
              {(contactDeals.data ?? []).map((deal) => (
                <li key={deal.id}>
                  <Link to={`/crm/${deal.id}`}>{deal.title}</Link>
                  {" — "}
                  {STAGE_LABELS[deal.stage]} · {formatDealAmount(deal)}
                </li>
              ))}
            </ul>
          </section>

          <section className="contacts-detail-panel">
            <h2>حقول مخصصة</h2>
            {(customFieldValues.data ?? []).length === 0 && <p className="hint-text">لا توجد حقول مخصصة</p>}
            <dl className="contacts-detail-dl">
              {(customFieldValues.data ?? []).map((field) => (
                <div key={field.id}>
                  <dt>{fieldLabelMap.get(field.definition_id) ?? field.definition_id}</dt>
                  <dd>{field.value_text || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="contacts-detail-panel">
            <h2>النشاط</h2>
            {activity.isLoading && <p className="hint-text">جاري التحميل…</p>}
            {act && (
              <>
                <div className="contacts-activity-block">
                  <strong>آخر رسالة</strong>
                  {act.last_message_text ? (
                    <>
                      <p>{act.last_message_text}</p>
                      <span className="hint-text">
                        {act.last_message_at ? formatContactDate(act.last_message_at) : ""}
                        {act.last_message_direction ? ` · ${act.last_message_direction === "inbound" ? "واردة" : "صادرة"}` : ""}
                      </span>
                    </>
                  ) : (
                    <p className="hint-text">لا توجد رسائل</p>
                  )}
                </div>
                <div className="contacts-activity-block">
                  <strong>المحادثات ({act.conversations.length})</strong>
                  {act.conversations.length === 0 && <p className="hint-text">لا توجد محادثات</p>}
                  <ul className="contacts-mini-list">
                    {act.conversations.map((conv) => (
                      <li key={conv.id}>
                        <Link to={`/inbox?conversation=${conv.id}`}>
                          {conv.status}{conv.is_blocked ? " · محظور" : ""}
                        </Link>
                        {conv.last_message_at && (
                          <span className="hint-text"> — {formatContactDate(conv.last_message_at)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                {act.notes.length > 0 && (
                  <div className="contacts-activity-block">
                    <strong>ملاحظات</strong>
                    <ul className="contacts-mini-list">
                      {act.notes.map((note) => (
                        <li key={note.id}>
                          {note.body}
                          {note.created_at && <span className="hint-text"> — {formatContactDate(note.created_at)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </section>

      {editOpen && (
        <ContactEditModal
          contact={item}
          saving={saving}
          onClose={() => setEditOpen(false)}
          onSave={async (payload) => {
            setSaving(true);
            try {
              const response = await api.patch<Contact>(`/contacts/${item.id}`, payload);
              await refreshContactsAfterMutation(client, response.data);
              await client.invalidateQueries({ queryKey: ["contact", id] });
              setEditOpen(false);
              toastStore.getState().show("تم حفظ التعديلات.", "success");
            } catch {
              toastStore.getState().show("تعذر حفظ التعديلات.", "error");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </main>
  );
}

function ContactEditModal({
  contact,
  saving,
  onClose,
  onSave
}: {
  contact: Contact;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, string | boolean | null>) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(contact.display_name ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [language, setLanguage] = useState(contact.language ?? "");
  const [countryCode, setCountryCode] = useState(contact.country_code ?? "");
  const [marketingOptIn, setMarketingOptIn] = useState(contact.marketing_opt_in !== false);
  const [lifecycleStage, setLifecycleStage] = useState(contact.lifecycle_stage ?? "lead");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({
      display_name: displayName.trim() || null,
      email: email.trim() || null,
      language: language.trim() || null,
      country_code: countryCode.trim() ? countryCode.trim().toUpperCase() : null,
      marketing_opt_in: marketingOptIn,
      lifecycle_stage: lifecycleStage
    });
  }

  return (
    <div className="contacts-modal-overlay" onClick={onClose}>
      <div className="contacts-modal" onClick={(e) => e.stopPropagation()}>
        <header className="contacts-modal-header">
          <h2>تعديل العميل</h2>
          <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={onClose}>×</button>
        </header>
        <form className="stack-form contacts-modal-form" onSubmit={(e) => void submit(e)}>
          <label className="field-label">
            <span>الاسم</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="field-label">
            <span>البريد</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </label>
          <label className="field-label">
            <span>اللغة</span>
            <input value={language} onChange={(e) => setLanguage(e.target.value)} />
          </label>
          <label className="field-label">
            <span>رمز الدولة</span>
            <input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} maxLength={2} dir="ltr" />
          </label>
          <label className="field-label">
            <span>مرحلة العميل</span>
            <select value={lifecycleStage} onChange={(e) => setLifecycleStage(e.target.value)}>
              {Object.entries(LIFECYCLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field-label contacts-checkbox-label">
            <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
            <span>موافقة على رسائل التسويق</span>
          </label>
          <div className="contacts-erp-actions">
            <button type="submit" className="contacts-erp-btn contacts-erp-btn-primary" disabled={saving}>
              {saving ? "جاري الحفظ…" : "حفظ"}
            </button>
            <button type="button" className="contacts-erp-btn" onClick={onClose}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ContactInterestsEditor({
  contactId,
  assigned,
  options,
  onSaved
}: {
  contactId: string;
  assigned: string[];
  options: InterestCategory[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(assigned);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(assigned);
  }, [assigned]);

  function toggle(interestId: string) {
    setSelected((current) =>
      current.includes(interestId) ? current.filter((id) => id !== interestId) : [...current, interestId]
    );
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/contacts/${contactId}/interests`, { interest_ids: selected });
      onSaved();
      toastStore.getState().show("تم حفظ الاهتمامات.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ الاهتمامات.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="contacts-tags-cell">
      {options.map((interest) => {
        const active = selected.includes(interest.id);
        const hint = interestGenderHint(interest);
        return (
          <button
            key={interest.id}
            type="button"
            className={`contacts-tag-chip ${active ? "contacts-tag-chip-active" : ""}`}
            onClick={() => toggle(interest.id)}
            title={hint ?? undefined}
          >
            {interest.label}
            {hint && <small> · {hint}</small>}
          </button>
        );
      })}
      <button type="button" className="contacts-erp-btn" disabled={saving} onClick={() => void save()}>
        {saving ? "جاري الحفظ…" : "حفظ الاهتمامات"}
      </button>
    </div>
  );
}
