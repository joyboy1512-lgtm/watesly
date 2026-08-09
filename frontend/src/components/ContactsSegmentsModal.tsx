import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  buildSegmentFilterJson,
  describeSegmentFilters,
  type Channel,
  type Organization,
  type SegmentFilterJson,
  type Tag
} from "../lib/contactHelpers";
import { slugifyInterestLabel, type InterestCategory } from "../lib/interestHelpers";
import { toastStore } from "../stores/toast";

type Segment = { id: string; name: string; filter_json: Record<string, unknown> };

type Props = {
  open: boolean;
  onClose: () => void;
  segments: Segment[];
  segmentCounts: Map<string, number> | undefined;
  organizations: Organization[];
  channels: Channel[];
  tags: Tag[];
  activeFilters: SegmentFilterJson;
  onApplySegment: (segmentId: string) => void;
};

export default function ContactsSegmentsModal({
  open,
  onClose,
  segments,
  segmentCounts,
  organizations,
  channels,
  tags,
  activeFilters,
  onApplySegment
}: Props) {
  const client = useQueryClient();
  const [segmentName, setSegmentName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagOrgId, setNewTagOrgId] = useState(activeFilters.organization_id ?? "");
  const [newInterestLabel, setNewInterestLabel] = useState("");

  const interests = useQuery({
    queryKey: ["interests"],
    queryFn: async () => (await api.get<InterestCategory[]>("/platform/interests")).data
  });

  const filterPreview = useMemo(() => {
    const org = organizations.find((item) => item.id === activeFilters.organization_id);
    const channel = channels.find((item) => item.id === activeFilters.channel_id);
    const tag = tags.find((item) => item.id === activeFilters.tag_id);
    return describeSegmentFilters(activeFilters, {
      organizationName: org?.name,
      channelName: channel?.name,
      tagName: tag?.name
    });
  }, [activeFilters, organizations, channels, tags]);

  if (!open) return null;

  async function createSegment(event: FormEvent) {
    event.preventDefault();
    const filter_json = buildSegmentFilterJson(activeFilters);
    await api.post("/platform/segments", { name: segmentName.trim(), filter_json });
    setSegmentName("");
    await client.invalidateQueries({ queryKey: ["segments"] });
    await client.invalidateQueries({ queryKey: ["segment-counts"] });
    toastStore.getState().show("تم إنشاء الشريحة.", "success");
  }

  async function createTag(event: FormEvent) {
    event.preventDefault();
    if (!newTagOrgId) {
      toastStore.getState().show("اختر الفرع للوسم.", "error");
      return;
    }
    await api.post("/inbox-tools/tags", {
      organization_id: newTagOrgId,
      name: newTagName.trim()
    });
    setNewTagName("");
    await client.invalidateQueries({ queryKey: ["tags"] });
    toastStore.getState().show("تم إنشاء الوسم.", "success");
  }

  async function createInterest(event: FormEvent) {
    event.preventDefault();
    const label = newInterestLabel.trim();
    if (!label) return;
    await api.post("/platform/interests", {
      slug: slugifyInterestLabel(label),
      label
    });
    setNewInterestLabel("");
    await client.invalidateQueries({ queryKey: ["interests"] });
    toastStore.getState().show("تم إنشاء الاهتمام.", "success");
  }

  return (
    <div className="contacts-modal-backdrop" onClick={onClose}>
      <div
        className="contacts-modal-card contacts-segments-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contacts-segments-title"
      >
        <header className="contacts-modal-header">
          <div>
            <h2 id="contacts-segments-title">الشرائح</h2>
            <p className="hint-text">
              الشريحة مجموعة عملاء تُحدَّد تلقائياً حسب الفلاتر (الفرع، الوسم، المرحلة…). لإضافة عميل لشريحة، عيّن له
              الفرع/الوسم/المرحلة المناسبة عند الإنشاء.
            </p>
          </div>
          <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={onClose}>
            إغلاق
          </button>
        </header>

        <div className="contacts-segments-grid">
          <section className="contacts-segments-panel">
            <h3>إنشاء شريحة جديدة</h3>
            <p className="contacts-segments-filter-preview">
              <span>الفلاتر الحالية:</span> {filterPreview}
            </p>
            <form className="stack-form" onSubmit={(e) => void createSegment(e)}>
              <label className="field-label">
                <span>اسم الشريحة</span>
                <input
                  value={segmentName}
                  onChange={(e) => setSegmentName(e.target.value)}
                  placeholder="مثال: عملاء الكويت — مهتمون"
                  required
                />
              </label>
              <button type="submit" className="contacts-erp-btn contacts-erp-btn-primary" disabled={!segmentName.trim()}>
                حفظ الشريحة
              </button>
            </form>
            <p className="hint-text">
              نصيحة: طبّق الفلاتر في شريط الأدوات أعلى جدول العملاء ثم افتح هذه النافذة لحفظها كشريحة.
            </p>
          </section>

          <section className="contacts-segments-panel">
            <h3>وسم جديد (لتجميع العملاء)</h3>
            <form className="stack-form" onSubmit={(e) => void createTag(e)}>
              <label className="field-label">
                <span>الفرع</span>
                <select value={newTagOrgId} onChange={(e) => setNewTagOrgId(e.target.value)} required>
                  <option value="">اختر الفرع</option>
                  {organizations.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                <span>اسم الوسم</span>
                <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="VIP" required />
              </label>
              <button type="submit" className="contacts-erp-btn" disabled={!newTagName.trim() || !newTagOrgId}>
                إنشاء وسم
              </button>
            </form>
          </section>

          <section className="contacts-segments-panel">
            <h3>اهتمام جديد</h3>
            <p className="hint-text">الاهتمامات تصنّف العملاء وتُستخدم في الحملات (مثل: عطور، مكياج، أثاث).</p>
            <form className="stack-form" onSubmit={(e) => void createInterest(e)}>
              <label className="field-label">
                <span>اسم الاهتمام</span>
                <input
                  value={newInterestLabel}
                  onChange={(e) => setNewInterestLabel(e.target.value)}
                  placeholder="مثال: عطور"
                  required
                />
              </label>
              <button type="submit" className="contacts-erp-btn" disabled={!newInterestLabel.trim()}>
                إضافة اهتمام
              </button>
            </form>
            <ul className="contacts-mini-list">
              {(interests.data ?? []).map((item) => (
                <li key={item.id}>{item.label}</li>
              ))}
            </ul>
          </section>

          <section className="contacts-segments-panel contacts-segments-list-panel">
            <h3>الشرائح المحفوظة ({segments.length})</h3>
            {segments.length === 0 && <p className="hint-text">لا توجد شرائح بعد.</p>}
            <ul className="contacts-mini-list">
              {segments.map((segment) => (
                <li key={segment.id}>
                  <button
                    type="button"
                    className="contacts-segment-link"
                    onClick={() => {
                      onApplySegment(segment.id);
                      onClose();
                    }}
                  >
                    {segment.name}
                    {segmentCounts?.has(segment.id) ? ` (${segmentCounts.get(segment.id)})` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
