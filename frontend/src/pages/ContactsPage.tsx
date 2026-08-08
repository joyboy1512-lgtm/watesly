import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  CONTACTS_LIST_LIMIT,
  CONTACTS_PAGE_SIZE,
  contactDisplayLabel,
  contactInitials,
  downloadContactsExport,
  downloadContactsImportTemplate,
  formatContactDate,
  formatGenderLabel,
  formatLifecycleStage,
  LIFECYCLE_LABELS,
  openContactConversation,
  tagChipColor,
  type Channel,
  type Contact,
  type ContactStats,
  type Organization,
  type Tag
} from "../lib/contactHelpers";
import Icon from "../components/Icon";
import { toastStore } from "../stores/toast";

type Segment = { id: string; name: string; filter_json: Record<string, unknown> };
type SegmentCount = { segment_id: string; count: number };
type DuplicateGroup = { phone: string; contact_ids: string[]; count: number };
type CustomField = { id: string; field_key: string; label: string; field_type: string };

export default function ContactsPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState(searchParams.get("channel_id") ?? "");
  const [organizationFilter, setOrganizationFilter] = useState(searchParams.get("organization_id") ?? "");
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag_id") ?? "");
  const [segmentFilter, setSegmentFilter] = useState(searchParams.get("segment_id") ?? "");
  const [lifecycleFilter, setLifecycleFilter] = useState(searchParams.get("lifecycle_stage") ?? "");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTagId, setBulkTagId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");

  useEffect(() => {
    const fromCreate = (location.state as { fromCreate?: boolean } | null)?.fromCreate;
    if (!fromCreate) return;
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
    setSelectedIds(new Set());
  }, [location.state]);

  useEffect(() => {
    const query = searchParams.get("q");
    if (query) setSearch(query);
    const channel = searchParams.get("channel_id");
    if (channel) setChannelFilter(channel);
    const organization = searchParams.get("organization_id");
    if (organization) setOrganizationFilter(organization);
    const tag = searchParams.get("tag_id");
    if (tag) setTagFilter(tag);
    const segment = searchParams.get("segment_id");
    if (segment) setSegmentFilter(segment);
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [debouncedSearch, channelFilter, organizationFilter, tagFilter, segmentFilter, lifecycleFilter]);

  function updateFilterParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function onChannelFilterChange(value: string) {
    setChannelFilter(value);
    updateFilterParam("channel_id", value);
  }

  function onOrganizationFilterChange(value: string) {
    setOrganizationFilter(value);
    updateFilterParam("organization_id", value);
  }

  function onTagFilterChange(value: string) {
    setTagFilter(value);
    updateFilterParam("tag_id", value);
  }

  function onSegmentFilterChange(value: string) {
    setSegmentFilter(value);
    updateFilterParam("segment_id", value);
  }

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
  const contacts = useQuery({
    queryKey: ["contacts", debouncedSearch, channelFilter, organizationFilter, tagFilter, segmentFilter, lifecycleFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: CONTACTS_LIST_LIMIT };
      if (debouncedSearch) params.q = debouncedSearch;
      if (channelFilter) params.channel_id = channelFilter;
      if (organizationFilter) params.organization_id = organizationFilter;
      if (tagFilter) params.tag_id = tagFilter;
      if (segmentFilter) params.segment_id = segmentFilter;
      if (lifecycleFilter) params.lifecycle_stage = lifecycleFilter;
      return (await api.get<Contact[]>("/contacts", { params })).data;
    },
    refetchOnMount: "always"
  });
  const stats = useQuery({
    queryKey: ["contacts-stats"],
    queryFn: async () => (await api.get<ContactStats>("/contacts/stats")).data
  });
  const duplicates = useQuery({
    queryKey: ["contacts-duplicates"],
    queryFn: async () => (await api.get<DuplicateGroup[]>("/contacts/duplicates")).data
  });
  const segments = useQuery({
    queryKey: ["segments"],
    queryFn: async () => (await api.get<Segment[]>("/platform/segments")).data
  });
  const segmentCounts = useQuery({
    queryKey: ["segment-counts", segments.data?.map((s) => s.id).join(",")],
    enabled: Boolean(segments.data?.length),
    queryFn: async () => {
      const items = segments.data ?? [];
      const results = await Promise.all(
        items.map(async (segment) => {
          const response = await api.get<SegmentCount>(`/platform/segments/${segment.id}/count`);
          return { id: segment.id, count: response.data.count };
        })
      );
      return new Map(results.map((item) => [item.id, item.count]));
    }
  });
  const customFields = useQuery({
    queryKey: ["custom-fields"],
    queryFn: async () => (await api.get<CustomField[]>("/platform/custom-fields")).data,
    enabled: advancedOpen
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

  const duplicatePhones = useMemo(() => {
    return new Set((duplicates.data ?? []).map((group) => group.phone));
  }, [duplicates.data]);

  const rows = contacts.data ?? [];
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * CONTACTS_PAGE_SIZE + 1;
  const pageEnd = Math.min(safePage * CONTACTS_PAGE_SIZE, total);
  const paginatedRows = rows.slice((safePage - 1) * CONTACTS_PAGE_SIZE, safePage * CONTACTS_PAGE_SIZE);
  const pageIds = paginatedRows.map((item) => item.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;
  const selectedContacts = rows.filter((item) => selectedIds.has(item.id));

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkTagId("");
  }

  async function handleExportAll() {
    await downloadContactsExport();
  }

  async function handleExportSelected() {
    if (!selectedContacts.length) return;
    try {
      await downloadContactsExport([...selectedIds]);
      toastStore.getState().show(`تم تحميل ${selectedContacts.length} عميل.`, "success");
    } catch {
      // API errors are surfaced by the axios interceptor.
    }
  }

  async function bulkDelete() {
    if (!selectedCount) return;
    if (!window.confirm(`حذف ${selectedCount} عميل؟`)) return;
    try {
      await Promise.all([...selectedIds].map((id) => api.delete(`/contacts/${id}`)));
      await client.invalidateQueries({ queryKey: ["contacts"] });
      clearSelection();
      toastStore.getState().show("تم حذف العملاء المحدّدين.", "success");
    } catch {
      toastStore.getState().show("تعذر حذف بعض العملاء.", "error");
    }
  }

  async function bulkAddTag() {
    if (!bulkTagId || !selectedCount) return;
    try {
      await Promise.all([...selectedIds].map((id) => api.post(`/contacts/${id}/tags/${bulkTagId}`)));
      await client.invalidateQueries({ queryKey: ["contact-tags"] });
      setBulkTagId("");
      toastStore.getState().show("تمت إضافة الوسم للمحدّدين.", "success");
    } catch {
      toastStore.getState().show("تعذر إضافة الوسم.", "error");
    }
  }

  async function createSegment(event: FormEvent) {
    event.preventDefault();
    await api.post("/platform/segments", {
      name: segmentName,
      filter_json: { search: debouncedSearch || undefined }
    });
    setSegmentName("");
    await client.invalidateQueries({ queryKey: ["segments"] });
    toastStore.getState().show("تم إنشاء الشريحة.", "success");
  }

  async function createField(event: FormEvent) {
    event.preventDefault();
    await api.post("/platform/custom-fields", { field_key: fieldKey, label: fieldLabel, entity_type: "contact" });
    setFieldKey("");
    setFieldLabel("");
    await client.invalidateQueries({ queryKey: ["custom-fields"] });
  }

  return (
    <main className="page contacts-page contacts-erp-page">
      <section className="contacts-erp-shell">
        <header className="contacts-erp-header">
          <div className="contacts-erp-title-block">
            <span className="contacts-erp-eyebrow">جهات الاتصال</span>
            <h1>العملاء</h1>
          </div>
          <Link to="/reports?tab=customers" className="contacts-erp-btn">تقارير العملاء</Link>
        </header>

        {stats.data && (
          <section className="admin-stats-row admin-stats-row-brand contacts-stats-brand">
            <article className="admin-stat-card admin-stat-card-brand">
              <span>إجمالي العملاء</span>
              <strong>{stats.data.total.toLocaleString("ar")}</strong>
            </article>
            <article className="admin-stat-card admin-stat-card-brand">
              <span>جدد هذا الأسبوع</span>
              <strong>{stats.data.new_this_week.toLocaleString("ar")}</strong>
            </article>
            <article className="admin-stat-card admin-stat-card-brand">
              <span>بدون اسم</span>
              <strong>{stats.data.without_name.toLocaleString("ar")}</strong>
            </article>
            <article className="admin-stat-card admin-stat-card-brand">
              <span>غير نشط (30 يوم)</span>
              <strong>{stats.data.inactive_30d.toLocaleString("ar")}</strong>
            </article>
          </section>
        )}

        <div className="contacts-erp-toolbar">
          <div className="contacts-erp-actions">
            <Link to="/contacts/new" className="contacts-erp-btn contacts-erp-btn-primary">
              إنشاء عميل جديد
            </Link>
            <Link to="/contacts/import" className="contacts-erp-btn">
              رفع Excel
            </Link>
            <button
              type="button"
              className="contacts-erp-btn"
              onClick={() => void downloadContactsImportTemplate().catch(() => toastStore.getState().show("تعذر تحميل القالب.", "error"))}
            >
              قالب Excel
            </button>
            <button type="button" className="contacts-erp-btn contacts-erp-btn-icon" onClick={() => void handleExportAll()} title="تحميل الكل">
              ⬇ تحميل
            </button>
            {selectedCount > 0 && (
              <>
                <span className="contacts-selection-badge">{selectedCount} محدّد</span>
                <button type="button" className="contacts-erp-btn" onClick={() => void handleExportSelected()}>
                  تحميل المحدّد
                </button>
                <div className="contacts-bulk-tag">
                  <select value={bulkTagId} onChange={(e) => setBulkTagId(e.target.value)}>
                    <option value="">إضافة وسم…</option>
                    {(tags.data ?? []).map((tag) => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                  <button type="button" className="contacts-erp-btn" disabled={!bulkTagId} onClick={() => void bulkAddTag()}>
                    تطبيق
                  </button>
                </div>
                <Link
                  to={`/campaigns?action=create&contact_ids=${[...selectedIds].join(",")}`}
                  className="contacts-erp-btn contacts-erp-btn-primary"
                >
                  إنشاء حملة
                </Link>
                <button type="button" className="contacts-erp-btn contacts-erp-btn-danger" onClick={() => void bulkDelete()}>
                  حذف
                </button>
                <button type="button" className="contacts-erp-btn contacts-erp-btn-ghost" onClick={clearSelection}>
                  إلغاء التحديد
                </button>
              </>
            )}
          </div>

          <div className="contacts-erp-meta">
            <select
              value={segmentFilter}
              onChange={(e) => onSegmentFilterChange(e.target.value)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب الشريحة"
            >
              <option value="">كل الشرائح</option>
              {(segments.data ?? []).map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                  {segmentCounts.data?.has(segment.id) ? ` (${segmentCounts.data.get(segment.id)})` : ""}
                </option>
              ))}
            </select>
            <select
              value={organizationFilter}
              onChange={(e) => onOrganizationFilterChange(e.target.value)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب الفرع"
            >
              <option value="">كل الأفرع</option>
              {(organizations.data ?? []).map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
            <select
              value={tagFilter}
              onChange={(e) => onTagFilterChange(e.target.value)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب الوسم"
            >
              <option value="">كل الوسوم</option>
              {(tags.data ?? []).map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
            <select
              value={lifecycleFilter}
              onChange={(e) => {
                setLifecycleFilter(e.target.value);
                setPage(1);
              }}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب مرحلة العميل"
            >
              <option value="">كل المراحل</option>
              {Object.entries(LIFECYCLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              value={channelFilter}
              onChange={(e) => onChannelFilterChange(e.target.value)}
              className="contacts-erp-channel-filter"
              aria-label="تصفية حسب القناة"
            >
              <option value="">كل القنوات</option>
              {(channels.data ?? []).map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
            <div className="contacts-erp-search">
              <Icon name="search" size={16} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث…"
                aria-label="بحث في العملاء"
              />
            </div>
            <div className="contacts-erp-pagination">
              <span>{total === 0 ? "0 / 0" : `${pageStart}-${pageEnd} / ${total}`}</span>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="السابق">
                ‹
              </button>
              <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="التالي">
                ›
              </button>
            </div>
          </div>
        </div>

        <div className="contacts-erp-table-wrap">
          {contacts.isLoading && (
            <div className="contacts-erp-loading">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="contacts-erp-skeleton-row" />
              ))}
            </div>
          )}

          {contacts.isError && (
            <div className="contacts-erp-empty">
              <strong>تعذر تحميل العملاء</strong>
              <button type="button" className="contacts-erp-btn" onClick={() => void contacts.refetch()}>إعادة المحاولة</button>
            </div>
          )}

          {!contacts.isLoading && !contacts.isError && total === 0 && (
            <div className="contacts-erp-empty">
              <strong>لا يوجد عملاء</strong>
              <p>ابدأ بإنشاء عميل أو رفع ملف Excel.</p>
              <div className="contacts-erp-actions">
                <Link to="/contacts/new" className="contacts-erp-btn contacts-erp-btn-primary">إنشاء عميل جديد</Link>
                <Link to="/contacts/import" className="contacts-erp-btn">رفع Excel</Link>
              </div>
            </div>
          )}

          {total > 0 && !contacts.isLoading && (
            <table className="contacts-erp-table">
              <thead>
                <tr>
                  <th className="contacts-col-check">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      onChange={togglePageSelection}
                      aria-label="تحديد الصفحة"
                    />
                  </th>
                  <th>الاسم</th>
                  <th>المرحلة</th>
                  <th>الجنس</th>
                  <th>الهاتف</th>
                  <th>البريد</th>
                  <th>الفرع</th>
                  <th>القناة</th>
                  <th>الوسوم</th>
                  <th>التسويق</th>
                  <th>تاريخ الإضافة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((item) => (
                  <ContactRow
                    key={item.id}
                    contact={item}
                    tags={tags.data ?? []}
                    organizationName={orgMap.get(item.organization_id) ?? "—"}
                    channelName={channelMap.get(item.channel_id) ?? "—"}
                    selected={selectedIds.has(item.id)}
                    isDuplicate={duplicatePhones.has(item.external_address)}
                    onToggleSelect={() => toggleRow(item.id)}
                    onMessage={async () => {
                      try {
                        const conversationId = await openContactConversation(item.id);
                        navigate(`/inbox?conversation=${conversationId}`);
                      } catch {
                        toastStore.getState().show("تعذر فتح المحادثة.", "error");
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <details
        className="contacts-advanced-accordion"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>إعدادات متقدمة — الشرائح والحقول المخصصة</summary>
        <div className="contacts-advanced-grid">
          <div className="contacts-advanced-panel">
            <h3>الشرائح</h3>
            <form className="stack-form" onSubmit={(e) => void createSegment(e)}>
              <label className="field-label">
                <span>اسم الشريحة</span>
                <input value={segmentName} onChange={(e) => setSegmentName(e.target.value)} placeholder="مثال: عملاء الكويت" required />
              </label>
              <button type="submit" className="contacts-erp-btn">حفظ الشريحة</button>
            </form>
            <ul className="contacts-mini-list">
              {(segments.data ?? []).map((s) => (
                <li key={s.id}>
                  <button type="button" className="contacts-segment-link" onClick={() => onSegmentFilterChange(s.id)}>
                    {s.name}
                    {segmentCounts.data?.has(s.id) ? ` (${segmentCounts.data.get(s.id)})` : ""}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="contacts-advanced-panel">
            <h3>حقول مخصصة</h3>
            <form className="stack-form" onSubmit={(e) => void createField(e)}>
              <label className="field-label">
                <span>مفتاح الحقل</span>
                <input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="city" dir="ltr" required />
              </label>
              <label className="field-label">
                <span>التسمية</span>
                <input value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} placeholder="المدينة" required />
              </label>
              <button type="submit" className="contacts-erp-btn">إضافة حقل</button>
            </form>
            <ul className="contacts-mini-list">
              {(customFields.data ?? []).map((f) => (
                <li key={f.id}>{f.label} <span dir="ltr">({f.field_key})</span></li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </main>
  );
}

function ContactRow({
  contact,
  tags,
  organizationName,
  channelName,
  selected,
  isDuplicate,
  onToggleSelect,
  onMessage
}: {
  contact: Contact;
  tags: Tag[];
  organizationName: string;
  channelName: string;
  selected: boolean;
  isDuplicate: boolean;
  onToggleSelect: () => void;
  onMessage: () => void;
}) {
  const client = useQueryClient();
  const [tagOpen, setTagOpen] = useState(false);
  const tagRef = useRef<HTMLDivElement>(null);

  const contactTags = useQuery({
    queryKey: ["contact-tags", contact.id],
    queryFn: async () => (await api.get<Tag[]>(`/contacts/${contact.id}/tags`)).data
  });

  useEffect(() => {
    if (!tagOpen) return;
    function onDocClick(event: MouseEvent) {
      if (tagRef.current && !tagRef.current.contains(event.target as Node)) setTagOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [tagOpen]);

  async function addTag(tagId: string) {
    await api.post(`/contacts/${contact.id}/tags/${tagId}`);
    await client.invalidateQueries({ queryKey: ["contact-tags", contact.id] });
    setTagOpen(false);
  }

  async function removeTag(tagId: string) {
    await api.delete(`/contacts/${contact.id}/tags/${tagId}`);
    await client.invalidateQueries({ queryKey: ["contact-tags", contact.id] });
  }

  const assigned = contactTags.data ?? [];
  const available = tags.filter((tag) => !assigned.some((item) => item.id === tag.id));
  const displayLabel = contactDisplayLabel(contact);

  return (
    <tr className={selected ? "contacts-row-selected" : undefined} onClick={onToggleSelect}>
      <td className="contacts-col-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`تحديد ${displayLabel}`} />
      </td>
      <td className="contacts-col-name" onClick={(e) => e.stopPropagation()}>
        <div className="contacts-name-cell">
          <span className="contacts-avatar">{contactInitials(contact.display_name, contact.external_address)}</span>
          <Link to={`/contacts/${contact.id}`} className="contacts-name-link">
            <strong>{displayLabel}</strong>
          </Link>
          {isDuplicate && <span className="contacts-duplicate-badge" title="رقم مكرر">مكرر</span>}
        </div>
      </td>
      <td>{formatLifecycleStage(contact.lifecycle_stage)}</td>
      <td>{formatGenderLabel(contact.gender)}</td>
      <td dir="ltr" className="contacts-phone-cell">{contact.external_address}</td>
      <td dir="ltr">{contact.email || "—"}</td>
      <td>{organizationName}</td>
      <td>{channelName}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="contacts-tags-cell" ref={tagRef}>
          {assigned.map((tag) => {
            const colors = tagChipColor(tag.name);
            return (
              <button
                key={tag.id}
                type="button"
                className="contacts-tag-chip"
                style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
                onClick={() => void removeTag(tag.id)}
                title="إزالة الوسم"
              >
                {tag.name} ×
              </button>
            );
          })}
          <button type="button" className="contacts-tag-add" onClick={() => setTagOpen((v) => !v)}>
            + وسم
          </button>
          {tagOpen && (
            <div className="contacts-tag-dropdown">
              {available.length === 0 && <p className="hint-text">لا توجد وسوم إضافية</p>}
              {available.map((tag) => (
                <button key={tag.id} type="button" onClick={() => void addTag(tag.id)}>
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </td>
      <td>{contact.marketing_opt_in === false ? "✗" : "✓"}</td>
      <td className="contacts-date-cell">{formatContactDate(contact.created_at)}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <button type="button" className="contacts-erp-btn contacts-row-action" onClick={() => void onMessage()}>
          رسالة
        </button>
      </td>
    </tr>
  );
}
