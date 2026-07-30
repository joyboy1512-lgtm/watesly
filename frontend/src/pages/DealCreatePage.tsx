import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { contactDisplayLabel, type Contact, type Organization } from "../lib/contactHelpers";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "../lib/crmHelpers";
import { toastStore } from "../stores/toast";

export default function DealCreatePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [searchParams] = useSearchParams();

  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(searchParams.get("contact_id") ?? "");
  const [organizationId, setOrganizationId] = useState("");
  const [assignedId, setAssignedId] = useState("");
  const [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState("KWD");
  const [stage, setStage] = useState<DealStage>("lead");
  const [probability, setProbability] = useState("10");
  const [description, setDescription] = useState("");

  const contacts = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => (await api.get<Contact[]>("/contacts", { params: { limit: 500 } })).data
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await api.get<{ membership_id: string; full_name: string }[]>("/team/employees")).data
  });

  const selectedContact = useMemo(
    () => (contacts.data ?? []).find((item) => item.id === contactId) ?? null,
    [contacts.data, contactId]
  );

  async function createDeal(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api.post("/platform/crm/deals", {
        title: title.trim(),
        contact_id: contactId || null,
        organization_id: organizationId || null,
        assigned_membership_id: assignedId || null,
        amount: Number(amount) || 0,
        currency: currency.trim() || "KWD",
        stage,
        probability: Number(probability) || 0,
        description: description.trim() || null,
        source: contactId ? "contact" : "manual"
      });
      await client.invalidateQueries({ queryKey: ["deals"] });
      await client.invalidateQueries({ queryKey: ["crm-stats"] });
      toastStore.getState().show("تم إنشاء الصفقة.", "success");
      navigate(`/crm/${result.data.id}`);
    } catch {
      toastStore.getState().show("تعذر إنشاء الصفقة.", "error");
    }
  }

  return (
    <main className="page crm-page">
      <header className="page-header">
        <Link to="/crm" className="contacts-back-link">← CRM</Link>
        <h1>صفقة جديدة</h1>
      </header>
      <section className="card contacts-form-card">
        <form className="contacts-panel stack-form" onSubmit={(e) => void createDeal(e)}>
          <label className="field-label">
            <span>عنوان الصفقة</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field-label">
            <span>العميل</span>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">بدون عميل</option>
              {(contacts.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {contactDisplayLabel(item)}
                </option>
              ))}
            </select>
          </label>
          {selectedContact && (
            <p className="hint-text">مرتبط: {contactDisplayLabel(selectedContact)}</p>
          )}
          <div className="contacts-context-row">
            <label className="field-label">
              <span>الفرع</span>
              <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                <option value="">—</option>
                {(organizations.data ?? []).map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>المسؤول</span>
              <select value={assignedId} onChange={(e) => setAssignedId(e.target.value)}>
                <option value="">—</option>
                {(employees.data ?? []).map((item) => (
                  <option key={item.membership_id} value={item.membership_id}>{item.full_name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="contacts-context-row">
            <label className="field-label">
              <span>المبلغ</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} step="0.001" dir="ltr" />
            </label>
            <label className="field-label">
              <span>العملة</span>
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} dir="ltr" />
            </label>
            <label className="field-label">
              <span>الاحتمال %</span>
              <input value={probability} onChange={(e) => setProbability(e.target.value)} type="number" min={0} max={100} />
            </label>
          </div>
          <label className="field-label">
            <span>المرحلة</span>
            <select value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
              {DEAL_STAGES.map((item) => (
                <option key={item} value={item}>{STAGE_LABELS[item]}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>الوصف</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </label>
          <div className="contacts-form-actions">
            <button type="submit" className="whatsapp-button">حفظ الصفقة</button>
            <Link to="/crm" className="secondary-button">إلغاء</Link>
          </div>
        </form>
      </section>
    </main>
  );
}
