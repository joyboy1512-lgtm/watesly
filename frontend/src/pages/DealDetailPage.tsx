import { FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { contactDisplayLabel, openContactConversation } from "../lib/contactHelpers";
import {
  DEAL_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  formatDealAmount,
  type Deal,
  type DealActivity,
  type DealStage
} from "../lib/crmHelpers";
import { toastStore } from "../stores/toast";

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editProbability, setEditProbability] = useState("");

  const deal = useQuery({
    queryKey: ["deal", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<Deal>(`/platform/crm/deals/${id}`)).data
  });

  const activities = useQuery({
    queryKey: ["deal-activities", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get<DealActivity[]>(`/platform/crm/deals/${id}/activities`)).data
  });

  function openEdit() {
    if (!deal.data) return;
    setEditTitle(deal.data.title);
    setEditAmount(deal.data.amount);
    setEditProbability(String(deal.data.probability ?? 0));
    setEditOpen(true);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    try {
      await api.patch(`/platform/crm/deals/${id}`, {
        title: editTitle.trim(),
        amount: Number(editAmount) || 0,
        probability: Number(editProbability) || 0
      });
      setEditOpen(false);
      await client.invalidateQueries({ queryKey: ["deal", id] });
      await client.invalidateQueries({ queryKey: ["deals"] });
      toastStore.getState().show("تم التحديث.", "success");
    } catch {
      toastStore.getState().show("تعذر التحديث.", "error");
    }
  }

  async function changeStage(stage: DealStage) {
    if (!id) return;
    await api.patch(`/platform/crm/deals/${id}/stage`, { stage });
    await client.invalidateQueries({ queryKey: ["deal", id] });
    await client.invalidateQueries({ queryKey: ["deals"] });
    await client.invalidateQueries({ queryKey: ["crm-stats"] });
    await client.invalidateQueries({ queryKey: ["deal-activities", id] });
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!id || !noteText.trim()) return;
    await api.post(`/platform/crm/deals/${id}/activities`, { activity_type: "note", body: noteText.trim() });
    setNoteText("");
    await client.invalidateQueries({ queryKey: ["deal-activities", id] });
  }

  async function removeDeal() {
    if (!id || !window.confirm("حذف الصفقة؟")) return;
    await api.delete(`/platform/crm/deals/${id}`);
    toastStore.getState().show("تم الحذف.", "success");
    navigate("/crm");
  }

  async function messageContact() {
    if (!deal.data?.contact_id) return;
    try {
      const conversationId = await openContactConversation(deal.data.contact_id);
      window.location.href = `/inbox?conversation=${conversationId}`;
    } catch {
      toastStore.getState().show("تعذر فتح المحادثة.", "error");
    }
  }

  if (deal.isLoading) return <main className="page"><p className="hint-text">جاري التحميل…</p></main>;
  if (!deal.data) return <main className="page"><p className="hint-text">الصفقة غير موجودة.</p></main>;

  const item = deal.data;

  return (
    <main className="page crm-page">
      <header className="page-header">
        <Link to="/crm" className="contacts-back-link">← CRM</Link>
        <h1>{item.title}</h1>
        <p>
          <span className={`crm-stage-pill ${STAGE_COLORS[item.stage]}`}>{STAGE_LABELS[item.stage]}</span>
          {" · "}
          {formatDealAmount(item)}
          {" · "}
          {item.probability}% احتمال
        </p>
      </header>

      <div className="crm-detail-grid">
        <section className="card">
          <h2 className="section-title-sm">تفاصيل الصفقة</h2>
          <dl className="crm-detail-list">
            <div><dt>العميل</dt><dd>
              {item.contact_id ? (
                <Link to={`/contacts/${item.contact_id}`}>
                  {contactDisplayLabel({ display_name: item.contact_name, external_address: item.contact_phone ?? "" })}
                </Link>
              ) : "—"}
            </dd></div>
            <div><dt>الفرع</dt><dd>{item.organization_name ?? "—"}</dd></div>
            <div><dt>المصدر</dt><dd>{item.source ?? "—"}</dd></div>
            <div><dt>تاريخ الإنشاء</dt><dd>{item.created_at ? new Date(item.created_at).toLocaleString("ar") : "—"}</dd></div>
          </dl>
          {item.description && <p className="hint-text">{item.description}</p>}
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={openEdit}>تعديل</button>
            {item.contact_id && (
              <button type="button" className="whatsapp-button" onClick={() => void messageContact()}>رسالة WhatsApp</button>
            )}
            <button type="button" className="danger-link" onClick={() => void removeDeal()}>حذف</button>
          </div>
          <label className="field-label">
            <span>تغيير المرحلة</span>
            <select value={item.stage} onChange={(e) => void changeStage(e.target.value as DealStage)}>
              {DEAL_STAGES.map((stage) => (
                <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="card">
          <h2 className="section-title-sm">النشاط</h2>
          <form className="stack-form" onSubmit={(e) => void addNote(e)}>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="ملاحظة جديدة…" rows={3} />
            <button type="submit" disabled={!noteText.trim()}>إضافة ملاحظة</button>
          </form>
          <ul className="crm-activity-list">
            {(activities.data ?? []).map((activity) => (
              <li key={activity.id}>
                <small>{activity.created_at ? new Date(activity.created_at).toLocaleString("ar") : ""} · {activity.activity_type}</small>
                <p>{activity.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {editOpen && (
        <div className="catalog-edit-overlay" role="dialog" aria-modal="true">
          <button type="button" className="catalog-edit-backdrop" aria-label="إغلاق" onClick={() => setEditOpen(false)} />
          <form className="catalog-edit-panel stack-form" onSubmit={(e) => void saveEdit(e)}>
            <h3>تعديل الصفقة</h3>
            <label className="field-label"><span>العنوان</span><input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required /></label>
            <label className="field-label"><span>المبلغ</span><input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} type="number" step="0.001" dir="ltr" /></label>
            <label className="field-label"><span>الاحتمال %</span><input value={editProbability} onChange={(e) => setEditProbability(e.target.value)} type="number" min={0} max={100} /></label>
            <div className="contacts-form-actions">
              <button type="submit" className="whatsapp-button">حفظ</button>
              <button type="button" className="secondary-button" onClick={() => setEditOpen(false)}>إلغاء</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
