import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import Icon from "../components/Icon";
import { toastStore } from "../stores/toast";
import {
  buildQuickReplyPayload,
  emptyQuickReplyForm,
  formFromQuickReply,
  type Organization,
  type QuickReply,
  type QuickReplyForm
} from "../lib/quickReplyHelpers";

type MainTab = "replies" | "buttons" | "lists";
type StatusTab = "active" | "archived";

type ButtonTemplate = {
  id: string;
  organization_id: string;
  name: string;
  body: string;
  titles: string;
  is_active: boolean;
};

type ListSection = { title: string; rows_text: string };

type ListTemplate = {
  id: string;
  organization_id: string;
  name: string;
  body: string;
  button_text: string;
  sections: ListSection[];
  is_active: boolean;
};

type ButtonForm = {
  organizationId: string;
  name: string;
  body: string;
  titles: [string, string, string];
};

type ListForm = {
  organizationId: string;
  name: string;
  body: string;
  buttonText: string;
  sectionTitle: string;
  options: string[];
};

const emptyButtonForm = (): ButtonForm => ({
  organizationId: "",
  name: "",
  body: "",
  titles: ["", "", ""]
});

const emptyListForm = (): ListForm => ({
  organizationId: "",
  name: "",
  body: "",
  buttonText: "القائمة",
  sectionTitle: "الخيارات",
  options: ["", "", ""]
});

export default function ComposerLibraryPage() {
  const client = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>("replies");
  const [statusTab, setStatusTab] = useState<StatusTab>("active");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [search, setSearch] = useState("");

  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null);
  const [replyForm, setReplyForm] = useState<QuickReplyForm>(emptyQuickReplyForm());

  const [buttonModalOpen, setButtonModalOpen] = useState(false);
  const [editingButton, setEditingButton] = useState<ButtonTemplate | null>(null);
  const [buttonForm, setButtonForm] = useState<ButtonForm>(emptyButtonForm());

  const [listModalOpen, setListModalOpen] = useState(false);
  const [editingList, setEditingList] = useState<ListTemplate | null>(null);
  const [listForm, setListForm] = useState<ListForm>(emptyListForm());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations.data ?? []) map.set(org.id, org.name);
    return map;
  }, [organizations.data]);

  const replies = useQuery({
    queryKey: ["quick-replies", "composer-library", statusTab, organizationFilter],
    enabled: mainTab === "replies",
    queryFn: async () => {
      const params: Record<string, string | boolean> = {};
      if (statusTab === "archived") params.include_inactive = true;
      if (organizationFilter) params.organization_id = organizationFilter;
      return (await api.get<QuickReply[]>("/inbox-tools/quick-replies", { params })).data;
    }
  });

  const buttons = useQuery({
    queryKey: ["composer-button-templates", "page", statusTab, organizationFilter],
    enabled: mainTab === "buttons",
    queryFn: async () => {
      const params: Record<string, string | boolean> = {};
      if (statusTab === "archived") params.include_inactive = true;
      if (organizationFilter) params.organization_id = organizationFilter;
      return (await api.get<ButtonTemplate[]>("/inbox-tools/composer-button-templates", { params })).data;
    }
  });

  const lists = useQuery({
    queryKey: ["composer-list-templates", "page", statusTab, organizationFilter],
    enabled: mainTab === "lists",
    queryFn: async () => {
      const params: Record<string, string | boolean> = {};
      if (statusTab === "archived") params.include_inactive = true;
      if (organizationFilter) params.organization_id = organizationFilter;
      return (await api.get<ListTemplate[]>("/inbox-tools/composer-list-templates", { params })).data;
    }
  });

  const visibleReplies = useMemo(() => {
    const rows = replies.data ?? [];
    const byStatus =
      statusTab === "archived" ? rows.filter((item) => !item.is_active) : rows.filter((item) => item.is_active);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((item) =>
      `${item.title} ${item.shortcut} ${item.body} ${orgMap.get(item.organization_id) ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [replies.data, statusTab, search, orgMap]);

  const visibleButtons = useMemo(() => {
    const rows = buttons.data ?? [];
    const byStatus =
      statusTab === "archived" ? rows.filter((item) => !item.is_active) : rows.filter((item) => item.is_active);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((item) =>
      `${item.name} ${item.body} ${item.titles} ${orgMap.get(item.organization_id) ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [buttons.data, statusTab, search, orgMap]);

  const visibleLists = useMemo(() => {
    const rows = lists.data ?? [];
    const byStatus =
      statusTab === "archived" ? rows.filter((item) => !item.is_active) : rows.filter((item) => item.is_active);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((item) =>
      `${item.name} ${item.body} ${item.button_text} ${orgMap.get(item.organization_id) ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [lists.data, statusTab, search, orgMap]);

  const visibleRows =
    mainTab === "replies" ? visibleReplies : mainTab === "buttons" ? visibleButtons : visibleLists;
  const activeCount = visibleRows.length;
  const visibleIds = useMemo(() => visibleRows.map((item) => item.id), [visibleRows]);
  const selectedCount = selectedIds.size;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  const isLoading =
    (mainTab === "replies" && replies.isLoading) ||
    (mainTab === "buttons" && buttons.isLoading) ||
    (mainTab === "lists" && lists.isLoading);

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleRowSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function openCreate() {
    const defaultOrg = organizationFilter || organizations.data?.[0]?.id || "";
    if (mainTab === "replies") {
      setEditingReply(null);
      setReplyForm({ ...emptyQuickReplyForm(), organizationId: defaultOrg });
      setReplyModalOpen(true);
    } else if (mainTab === "buttons") {
      setEditingButton(null);
      setButtonForm({ ...emptyButtonForm(), organizationId: defaultOrg });
      setButtonModalOpen(true);
    } else {
      setEditingList(null);
      setListForm({ ...emptyListForm(), organizationId: defaultOrg });
      setListModalOpen(true);
    }
  }

  async function saveReply(event: FormEvent) {
    event.preventDefault();
    try {
      const payload = buildQuickReplyPayload(replyForm);
      if (editingReply) {
        await api.patch(`/inbox-tools/quick-replies/${editingReply.id}`, payload);
        toastStore.getState().show("تم تحديث الرد.", "success");
      } else {
        await api.post("/inbox-tools/quick-replies", payload);
        toastStore.getState().show("تم حفظ الرد.", "success");
      }
      setReplyModalOpen(false);
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
    } catch {
      toastStore.getState().show("تعذر حفظ الرد.", "error");
    }
  }

  async function saveButton(event: FormEvent) {
    event.preventDefault();
    const titles = buttonForm.titles.map((item) => item.trim()).filter(Boolean).join("\n");
    if (!buttonForm.organizationId || !buttonForm.name.trim() || !buttonForm.body.trim() || !titles) {
      toastStore.getState().show("أكمل اسم القالب والنص وزرّاً واحداً على الأقل.", "error");
      return;
    }
    try {
      const payload = {
        organization_id: buttonForm.organizationId,
        name: buttonForm.name.trim(),
        body: buttonForm.body.trim(),
        titles
      };
      if (editingButton) {
        await api.patch(`/inbox-tools/composer-button-templates/${editingButton.id}`, {
          name: payload.name,
          body: payload.body,
          titles: payload.titles
        });
        toastStore.getState().show("تم تحديث قالب الأزرار.", "success");
      } else {
        await api.post("/inbox-tools/composer-button-templates", payload);
        toastStore.getState().show("تم حفظ قالب الأزرار.", "success");
      }
      setButtonModalOpen(false);
      await client.invalidateQueries({ queryKey: ["composer-button-templates"] });
    } catch {
      toastStore.getState().show("تعذر الحفظ — ربما الاسم مستخدم في نفس الفرع.", "error");
    }
  }

  async function saveList(event: FormEvent) {
    event.preventDefault();
    const options = listForm.options.map((item) => item.trim()).filter(Boolean);
    if (!listForm.organizationId || !listForm.name.trim() || !listForm.body.trim() || !options.length) {
      toastStore.getState().show("أكمل اسم القالب والنص وخياراً واحداً على الأقل.", "error");
      return;
    }
    try {
      const payload = {
        organization_id: listForm.organizationId,
        name: listForm.name.trim(),
        body: listForm.body.trim(),
        button_text: listForm.buttonText.trim().slice(0, 20) || "القائمة",
        sections: [
          {
            title: listForm.sectionTitle.trim() || "خيارات",
            rows_text: options.join("\n")
          }
        ]
      };
      if (editingList) {
        await api.patch(`/inbox-tools/composer-list-templates/${editingList.id}`, {
          name: payload.name,
          body: payload.body,
          button_text: payload.button_text,
          sections: payload.sections
        });
        toastStore.getState().show("تم تحديث قالب القائمة.", "success");
      } else {
        await api.post("/inbox-tools/composer-list-templates", payload);
        toastStore.getState().show("تم حفظ قالب القائمة.", "success");
      }
      setListModalOpen(false);
      await client.invalidateQueries({ queryKey: ["composer-list-templates"] });
    } catch {
      toastStore.getState().show("تعذر الحفظ — ربما الاسم مستخدم في نفس الفرع.", "error");
    }
  }

  async function archiveReply(item: QuickReply) {
    if (!window.confirm(`أرشفة "${item.title}"؟`)) return;
    try {
      await api.delete(`/inbox-tools/quick-replies/${item.id}`);
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
      toastStore.getState().show("تمت الأرشفة.", "success");
    } catch {
      toastStore.getState().show("تعذر الأرشفة.", "error");
    }
  }

  async function deleteReply(item: QuickReply) {
    if (!window.confirm(`حذف "${item.title}" نهائياً؟ لا يمكن التراجع.`)) return;
    try {
      await api.delete(`/inbox-tools/quick-replies/${item.id}`, { params: { permanent: true } });
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
      toastStore.getState().show("تم الحذف نهائياً.", "success");
    } catch {
      toastStore.getState().show("تعذر الحذف.", "error");
    }
  }

  async function restoreReply(item: QuickReply) {
    try {
      await api.patch(`/inbox-tools/quick-replies/${item.id}`, { is_active: true });
      await client.invalidateQueries({ queryKey: ["quick-replies"] });
      toastStore.getState().show("تمت الاستعادة.", "success");
    } catch {
      toastStore.getState().show("تعذر الاستعادة.", "error");
    }
  }

  async function archiveButton(item: ButtonTemplate) {
    if (!window.confirm(`أرشفة "${item.name}"؟`)) return;
    try {
      await api.delete(`/inbox-tools/composer-button-templates/${item.id}`);
      await client.invalidateQueries({ queryKey: ["composer-button-templates"] });
      toastStore.getState().show("تمت الأرشفة.", "success");
    } catch {
      toastStore.getState().show("تعذر الأرشفة.", "error");
    }
  }

  async function deleteButton(item: ButtonTemplate) {
    if (!window.confirm(`حذف "${item.name}" نهائياً؟ لا يمكن التراجع.`)) return;
    try {
      await api.delete(`/inbox-tools/composer-button-templates/${item.id}`, { params: { permanent: true } });
      await client.invalidateQueries({ queryKey: ["composer-button-templates"] });
      toastStore.getState().show("تم الحذف نهائياً.", "success");
    } catch {
      toastStore.getState().show("تعذر الحذف.", "error");
    }
  }

  async function restoreButton(item: ButtonTemplate) {
    try {
      await api.patch(`/inbox-tools/composer-button-templates/${item.id}`, { is_active: true });
      await client.invalidateQueries({ queryKey: ["composer-button-templates"] });
      toastStore.getState().show("تمت الاستعادة.", "success");
    } catch {
      toastStore.getState().show("تعذر الاستعادة.", "error");
    }
  }

  async function archiveList(item: ListTemplate) {
    if (!window.confirm(`أرشفة "${item.name}"؟`)) return;
    try {
      await api.delete(`/inbox-tools/composer-list-templates/${item.id}`);
      await client.invalidateQueries({ queryKey: ["composer-list-templates"] });
      toastStore.getState().show("تمت الأرشفة.", "success");
    } catch {
      toastStore.getState().show("تعذر الأرشفة.", "error");
    }
  }

  async function deleteList(item: ListTemplate) {
    if (!window.confirm(`حذف "${item.name}" نهائياً؟ لا يمكن التراجع.`)) return;
    try {
      await api.delete(`/inbox-tools/composer-list-templates/${item.id}`, { params: { permanent: true } });
      await client.invalidateQueries({ queryKey: ["composer-list-templates"] });
      toastStore.getState().show("تم الحذف نهائياً.", "success");
    } catch {
      toastStore.getState().show("تعذر الحذف.", "error");
    }
  }

  async function restoreList(item: ListTemplate) {
    try {
      await api.patch(`/inbox-tools/composer-list-templates/${item.id}`, { is_active: true });
      await client.invalidateQueries({ queryKey: ["composer-list-templates"] });
      toastStore.getState().show("تمت الاستعادة.", "success");
    } catch {
      toastStore.getState().show("تعذر الاستعادة.", "error");
    }
  }

  async function bulkArchiveSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`أرشفة ${ids.length} عنصر؟`)) return;
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try {
          if (mainTab === "replies") await api.delete(`/inbox-tools/quick-replies/${id}`);
          else if (mainTab === "buttons") await api.delete(`/inbox-tools/composer-button-templates/${id}`);
          else await api.delete(`/inbox-tools/composer-list-templates/${id}`);
          ok += 1;
        } catch {
          /* continue */
        }
      }
      clearSelection();
      await client.invalidateQueries({
        queryKey:
          mainTab === "replies"
            ? ["quick-replies"]
            : mainTab === "buttons"
              ? ["composer-button-templates"]
              : ["composer-list-templates"]
      });
      toastStore
        .getState()
        .show(ok === ids.length ? `تمت أرشفة ${ok} عنصر.` : `أُرشف ${ok} من ${ids.length}.`, ok ? "success" : "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDeleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`حذف ${ids.length} عنصر نهائياً؟ لا يمكن التراجع.`)) return;
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try {
          if (mainTab === "replies") {
            await api.delete(`/inbox-tools/quick-replies/${id}`, { params: { permanent: true } });
          } else if (mainTab === "buttons") {
            await api.delete(`/inbox-tools/composer-button-templates/${id}`, { params: { permanent: true } });
          } else {
            await api.delete(`/inbox-tools/composer-list-templates/${id}`, { params: { permanent: true } });
          }
          ok += 1;
        } catch {
          /* continue */
        }
      }
      clearSelection();
      await client.invalidateQueries({
        queryKey:
          mainTab === "replies"
            ? ["quick-replies"]
            : mainTab === "buttons"
              ? ["composer-button-templates"]
              : ["composer-list-templates"]
      });
      toastStore
        .getState()
        .show(ok === ids.length ? `تم حذف ${ok} عنصر نهائياً.` : `حُذف ${ok} من ${ids.length}.`, ok ? "success" : "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkRestoreSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try {
          if (mainTab === "replies") await api.patch(`/inbox-tools/quick-replies/${id}`, { is_active: true });
          else if (mainTab === "buttons") {
            await api.patch(`/inbox-tools/composer-button-templates/${id}`, { is_active: true });
          } else {
            await api.patch(`/inbox-tools/composer-list-templates/${id}`, { is_active: true });
          }
          ok += 1;
        } catch {
          /* continue */
        }
      }
      clearSelection();
      await client.invalidateQueries({
        queryKey:
          mainTab === "replies"
            ? ["quick-replies"]
            : mainTab === "buttons"
              ? ["composer-button-templates"]
              : ["composer-list-templates"]
      });
      toastStore
        .getState()
        .show(ok === ids.length ? `تمت استعادة ${ok} عنصر.` : `استُعيد ${ok} من ${ids.length}.`, ok ? "success" : "error");
    } finally {
      setBulkBusy(false);
    }
  }

  const createLabel =
    mainTab === "replies" ? "رد جديد" : mainTab === "buttons" ? "أزرار جديدة" : "قائمة جديدة";
  const emptyTitle =
    mainTab === "replies"
      ? statusTab === "archived"
        ? "لا توجد ردود مؤرشفة"
        : "لا توجد ردود بعد"
      : mainTab === "buttons"
        ? statusTab === "archived"
          ? "لا توجد أزرار مؤرشفة"
          : "لا توجد قوالب أزرار بعد"
        : statusTab === "archived"
          ? "لا توجد قوائم مؤرشفة"
          : "لا توجد قوالب قوائم بعد";
  const emptyHint =
    statusTab === "archived"
      ? "العناصر المؤرشفة تظهر هنا ويمكن استعادتها في أي وقت."
      : "أنشئ قالباً مشتركاً للفرع ليستخدمه الفريق من المحادثات.";

  return (
    <main className="page composer-library-page">
      <section className="composer-library-hero">
        <div className="composer-library-hero-copy">
          <span className="composer-library-eyebrow">مكتبة الفرع</span>
          <h1>مكتبة الرسائل</h1>
          <p>ردود وأزرار وقوائم مشتركة على مستوى الفرع — التعديل والأرشفة والحذف من هنا فقط.</p>
        </div>
        {statusTab === "active" && (
          <button type="button" className="whatsapp-button composer-library-hero-cta" onClick={openCreate}>
            <Icon name="plus" /> {createLabel}
          </button>
        )}
      </section>

      <div className="composer-library-type-tabs" role="tablist" aria-label="نوع المكتبة">
        {(
          [
            ["replies", "ردود", "نصوص جاهزة واختصارات"],
            ["buttons", "أزرار", "رسائل بأزرار رد سريع"],
            ["lists", "قوائم", "قوائم خيارات منظمة"]
          ] as const
        ).map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mainTab === key}
            className={`composer-library-type-tab${mainTab === key ? " active" : ""}`}
            onClick={() => {
              setMainTab(key);
              setStatusTab("active");
              setSearch("");
              clearSelection();
            }}
          >
            <span className="composer-library-type-icon" aria-hidden>
              <Icon name="template" size={18} />
            </span>
            <span className="composer-library-type-text">
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
            {mainTab === key && !isLoading && activeCount > 0 && (
              <b className="composer-library-type-count">{activeCount}</b>
            )}
          </button>
        ))}
      </div>

      <div className="composer-library-controls">
        <label className="composer-library-search">
          <Icon name="search" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في الاسم أو النص…"
            aria-label="بحث في المكتبة"
          />
        </label>
        <label className="field-label composer-library-branch">
          <span>الفرع</span>
          <select
            value={organizationFilter}
            onChange={(e) => {
              setOrganizationFilter(e.target.value);
              clearSelection();
            }}
          >
            <option value="">كل الفروع المتاحة</option>
            {(organizations.data ?? []).map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        <div className="composer-library-status-tabs" role="tablist" aria-label="حالة العناصر">
          <button
            type="button"
            className={statusTab === "active" ? "active" : ""}
            onClick={() => {
              setStatusTab("active");
              clearSelection();
            }}
          >
            نشطة
          </button>
          <button
            type="button"
            className={statusTab === "archived" ? "active" : ""}
            onClick={() => {
              setStatusTab("archived");
              clearSelection();
            }}
          >
            مؤرشفة
          </button>
        </div>
        {selectedCount > 0 && (
          <div className="composer-library-bulk" role="region" aria-label="إجراءات التحديد">
            <span className="composer-library-bulk-count">{selectedCount}</span>
            {statusTab === "active" ? (
              <>
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={bulkBusy}
                  onClick={() => void bulkArchiveSelected()}
                >
                  أرشفة
                </button>
                <button
                  type="button"
                  className="secondary-button compact danger-button"
                  disabled={bulkBusy}
                  onClick={() => void bulkDeleteSelected()}
                >
                  حذف
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary-button compact"
                  disabled={bulkBusy}
                  onClick={() => void bulkRestoreSelected()}
                >
                  استعادة
                </button>
                <button
                  type="button"
                  className="secondary-button compact danger-button"
                  disabled={bulkBusy}
                  onClick={() => void bulkDeleteSelected()}
                >
                  حذف
                </button>
              </>
            )}
            <button type="button" className="secondary-button compact" disabled={bulkBusy} onClick={clearSelection}>
              إلغاء
            </button>
          </div>
        )}
      </div>

      <section className="composer-library-board" aria-live="polite">
        {isLoading ? (
          <div className="composer-library-table-wrap composer-library-table-loading">
            <p className="hint-text">جاري التحميل…</p>
          </div>
        ) : activeCount === 0 ? (
          <div className="composer-library-empty">
            <div className="composer-library-empty-icon" aria-hidden>
              <Icon name="template" size={28} />
            </div>
            <strong>{emptyTitle}</strong>
            <p>{emptyHint}</p>
            {statusTab === "active" && (
              <button type="button" className="whatsapp-button" onClick={openCreate}>
                <Icon name="plus" /> {createLabel}
              </button>
            )}
          </div>
        ) : (
          <div className="composer-library-table-wrap">
            {mainTab === "replies" && (
              <table className="data-table composer-library-table">
                <thead>
                  <tr>
                    <th className="composer-library-col-check">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
                        }}
                        onChange={toggleAllVisible}
                        aria-label="تحديد الكل"
                      />
                    </th>
                    <th>العنوان</th>
                    <th className="composer-library-col-ltr">الاختصار</th>
                    <th>الفرع</th>
                    <th>النص</th>
                    <th className="composer-library-col-actions">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReplies.map((item) => (
                    <tr key={item.id} className={selectedIds.has(item.id) ? "is-selected" : undefined}>
                      <td className="composer-library-col-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleRowSelection(item.id)}
                          aria-label={`تحديد ${item.title}`}
                        />
                      </td>
                      <td>
                        <strong>{item.title}</strong>
                      </td>
                      <td className="composer-library-col-ltr" dir="ltr">
                        /{item.shortcut}
                      </td>
                      <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                      <td className="composer-library-preview">{item.body}</td>
                      <td className="composer-library-actions composer-library-col-actions">
                        {statusTab === "active" ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => {
                                setEditingReply(item);
                                setReplyForm(formFromQuickReply(item));
                                setReplyModalOpen(true);
                              }}
                            >
                              تعديل
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => void archiveReply(item)}
                            >
                              أرشفة
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact danger-button"
                              onClick={() => void deleteReply(item)}
                            >
                              حذف
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => void restoreReply(item)}
                            >
                              استعادة
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact danger-button"
                              onClick={() => void deleteReply(item)}
                            >
                              حذف
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {mainTab === "buttons" && (
              <table className="data-table composer-library-table">
                <thead>
                  <tr>
                    <th className="composer-library-col-check">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
                        }}
                        onChange={toggleAllVisible}
                        aria-label="تحديد الكل"
                      />
                    </th>
                    <th>الاسم</th>
                    <th>الفرع</th>
                    <th>النص</th>
                    <th>الأزرار</th>
                    <th className="composer-library-col-actions">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleButtons.map((item) => (
                    <tr key={item.id} className={selectedIds.has(item.id) ? "is-selected" : undefined}>
                      <td className="composer-library-col-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleRowSelection(item.id)}
                          aria-label={`تحديد ${item.name}`}
                        />
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                      <td className="composer-library-preview">{item.body}</td>
                      <td>{item.titles.split("\n").filter(Boolean).join(" · ")}</td>
                      <td className="composer-library-actions composer-library-col-actions">
                        {statusTab === "active" ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => {
                                const rows = item.titles.split("\n");
                                setEditingButton(item);
                                setButtonForm({
                                  organizationId: item.organization_id,
                                  name: item.name,
                                  body: item.body,
                                  titles: [rows[0] ?? "", rows[1] ?? "", rows[2] ?? ""]
                                });
                                setButtonModalOpen(true);
                              }}
                            >
                              تعديل
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => void archiveButton(item)}
                            >
                              أرشفة
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact danger-button"
                              onClick={() => void deleteButton(item)}
                            >
                              حذف
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => void restoreButton(item)}
                            >
                              استعادة
                            </button>
                            <button
                              type="button"
                              className="secondary-button compact danger-button"
                              onClick={() => void deleteButton(item)}
                            >
                              حذف
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {mainTab === "lists" && (
              <table className="data-table composer-library-table">
                <thead>
                  <tr>
                    <th className="composer-library-col-check">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
                        }}
                        onChange={toggleAllVisible}
                        aria-label="تحديد الكل"
                      />
                    </th>
                    <th>الاسم</th>
                    <th>الفرع</th>
                    <th>النص</th>
                    <th>الزر / الخيارات</th>
                    <th className="composer-library-col-actions">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLists.map((item) => {
                    const optionCount = item.sections.reduce(
                      (n, section) => n + section.rows_text.split("\n").filter(Boolean).length,
                      0
                    );
                    return (
                      <tr key={item.id} className={selectedIds.has(item.id) ? "is-selected" : undefined}>
                        <td className="composer-library-col-check">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleRowSelection(item.id)}
                            aria-label={`تحديد ${item.name}`}
                          />
                        </td>
                        <td>
                          <strong>{item.name}</strong>
                        </td>
                        <td>{orgMap.get(item.organization_id) ?? "—"}</td>
                        <td className="composer-library-preview">{item.body}</td>
                        <td>
                          {item.button_text} · {optionCount} خيار
                        </td>
                        <td className="composer-library-actions composer-library-col-actions">
                          {statusTab === "active" ? (
                            <>
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => {
                                  const first = item.sections[0];
                                  const options = (first?.rows_text ?? "").split("\n");
                                  while (options.length < 3) options.push("");
                                  setEditingList(item);
                                  setListForm({
                                    organizationId: item.organization_id,
                                    name: item.name,
                                    body: item.body,
                                    buttonText: item.button_text,
                                    sectionTitle: first?.title || "الخيارات",
                                    options
                                  });
                                  setListModalOpen(true);
                                }}
                              >
                                تعديل
                              </button>
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => void archiveList(item)}
                              >
                                أرشفة
                              </button>
                              <button
                                type="button"
                                className="secondary-button compact danger-button"
                                onClick={() => void deleteList(item)}
                              >
                                حذف
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => void restoreList(item)}
                              >
                                استعادة
                              </button>
                              <button
                                type="button"
                                className="secondary-button compact danger-button"
                                onClick={() => void deleteList(item)}
                              >
                                حذف
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {replyModalOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setReplyModalOpen(false)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void saveReply(e)}>
            <h2>{editingReply ? "تعديل رد" : "رد جديد"}</h2>
            <label className="field-label">
              <span>الفرع</span>
              <select
                required
                value={replyForm.organizationId}
                onChange={(e) => setReplyForm((current) => ({ ...current, organizationId: e.target.value }))}
                disabled={Boolean(editingReply)}
              >
                <option value="">اختر الفرع</option>
                {(organizations.data ?? []).map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>العنوان</span>
              <input
                required
                value={replyForm.title}
                onChange={(e) => setReplyForm((current) => ({ ...current, title: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span>الاختصار</span>
              <input
                required
                value={replyForm.shortcut}
                onChange={(e) => setReplyForm((current) => ({ ...current, shortcut: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span>نص الرد</span>
              <textarea
                required
                rows={4}
                value={replyForm.body}
                onChange={(e) => setReplyForm((current) => ({ ...current, body: e.target.value }))}
              />
            </label>
            <div className="inline-actions">
              <button type="submit" className="whatsapp-button">
                حفظ
              </button>
              <button type="button" className="secondary-button" onClick={() => setReplyModalOpen(false)}>
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {buttonModalOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setButtonModalOpen(false)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void saveButton(e)}>
            <h2>{editingButton ? "تعديل أزرار" : "أزرار جديدة"}</h2>
            <label className="field-label">
              <span>الفرع</span>
              <select
                required
                value={buttonForm.organizationId}
                onChange={(e) => setButtonForm((current) => ({ ...current, organizationId: e.target.value }))}
                disabled={Boolean(editingButton)}
              >
                <option value="">اختر الفرع</option>
                {(organizations.data ?? []).map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>اسم القالب</span>
              <input
                required
                value={buttonForm.name}
                onChange={(e) => setButtonForm((current) => ({ ...current, name: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span>نص الرسالة</span>
              <textarea
                required
                rows={3}
                value={buttonForm.body}
                onChange={(e) => setButtonForm((current) => ({ ...current, body: e.target.value }))}
              />
            </label>
            <div className="field-label inbox-button-titles">
              <span>نصوص الأزرار</span>
              <div className="inbox-button-title-rows">
                {buttonForm.titles.map((title, index) => (
                  <label key={index} className="inbox-button-title-row">
                    <span className="inbox-button-title-index">{index + 1}</span>
                    <input
                      value={title}
                      maxLength={20}
                      placeholder={`زر ${index + 1}`}
                      onChange={(e) =>
                        setButtonForm((current) => {
                          const titles = [...current.titles] as ButtonForm["titles"];
                          titles[index] = e.target.value;
                          return { ...current, titles };
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="inline-actions">
              <button type="submit" className="whatsapp-button">
                حفظ
              </button>
              <button type="button" className="secondary-button" onClick={() => setButtonModalOpen(false)}>
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {listModalOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => setListModalOpen(false)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void saveList(e)}>
            <h2>{editingList ? "تعديل قائمة" : "قائمة جديدة"}</h2>
            <label className="field-label">
              <span>الفرع</span>
              <select
                required
                value={listForm.organizationId}
                onChange={(e) => setListForm((current) => ({ ...current, organizationId: e.target.value }))}
                disabled={Boolean(editingList)}
              >
                <option value="">اختر الفرع</option>
                {(organizations.data ?? []).map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>اسم القالب</span>
              <input
                required
                value={listForm.name}
                onChange={(e) => setListForm((current) => ({ ...current, name: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span>نص الرسالة</span>
              <textarea
                required
                rows={3}
                value={listForm.body}
                onChange={(e) => setListForm((current) => ({ ...current, body: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span>نص زر القائمة</span>
              <input
                required
                maxLength={20}
                value={listForm.buttonText}
                onChange={(e) => setListForm((current) => ({ ...current, buttonText: e.target.value }))}
              />
            </label>
            <label className="field-label">
              <span>عنوان القسم</span>
              <input
                value={listForm.sectionTitle}
                maxLength={24}
                onChange={(e) => setListForm((current) => ({ ...current, sectionTitle: e.target.value }))}
              />
            </label>
            <div className="field-label inbox-button-titles">
              <span>الخيارات</span>
              <div className="inbox-button-title-rows">
                {listForm.options.map((option, index) => (
                  <div key={index} className="inbox-list-option-row">
                    <label className="inbox-button-title-row">
                      <span className="inbox-button-title-index">{index + 1}</span>
                      <input
                        value={option}
                        maxLength={24}
                        placeholder={`خيار ${index + 1}`}
                        onChange={(e) =>
                          setListForm((current) => {
                            const options = [...current.options];
                            options[index] = e.target.value;
                            return { ...current, options };
                          })
                        }
                      />
                    </label>
                    {listForm.options.length > 1 && (
                      <button
                        type="button"
                        className="secondary-action inbox-list-option-remove"
                        onClick={() =>
                          setListForm((current) => ({
                            ...current,
                            options: current.options.filter((_, i) => i !== index)
                          }))
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {listForm.options.length < 10 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setListForm((current) => ({ ...current, options: [...current.options, ""] }))}
                >
                  + خيار
                </button>
              )}
            </div>
            <div className="inline-actions">
              <button type="submit" className="whatsapp-button">
                حفظ
              </button>
              <button type="button" className="secondary-button" onClick={() => setListModalOpen(false)}>
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
