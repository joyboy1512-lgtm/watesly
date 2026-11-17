import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";

type FieldDef = {
  id: string;
  field_key: string;
  label: string;
  field_type: string;
};

type FieldValue = {
  definition_id: string;
  value_text: string | null;
};

type Props = {
  contactId: string | null;
  disabled?: boolean;
};

export default function InboxCustomFieldsPanel({ contactId, disabled }: Props) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const defs = useQuery({
    queryKey: ["custom-fields", "contact"],
    queryFn: async () =>
      (await api.get<FieldDef[]>("/platform/custom-fields", { params: { entity_type: "contact" } })).data
  });

  const values = useQuery({
    queryKey: ["contact-custom-fields", contactId],
    enabled: Boolean(contactId),
    queryFn: async () =>
      (await api.get<FieldValue[]>(`/contacts/${contactId}/custom-fields`)).data
  });

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const item of values.data ?? []) {
      next[item.definition_id] = item.value_text ?? "";
    }
    setDrafts(next);
  }, [values.data]);

  async function saveField(definitionId: string) {
    if (!contactId) return;
    setSavingId(definitionId);
    try {
      await api.post("/platform/custom-fields/values", {
        definition_id: definitionId,
        entity_id: contactId,
        value_text: drafts[definitionId] ?? ""
      });
      await queryClient.invalidateQueries({ queryKey: ["contact-custom-fields", contactId] });
      toastStore.getState().show("تم حفظ الحقل.", "success");
    } catch {
      toastStore.getState().show("تعذر حفظ الحقل.", "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="customer-section">
      <h4>حقول مخصصة</h4>
      {defs.isLoading && <p className="hint-text">جاري التحميل…</p>}
      {!defs.isLoading && !(defs.data ?? []).length && (
        <p className="hint-text">لا توجد حقول مخصصة بعد. أضفها من إعدادات المنصة.</p>
      )}
      <div className="inbox-custom-fields">
        {(defs.data ?? []).map((field) => (
          <label key={field.id} className="control-label">
            <span>{field.label}</span>
            <div className="inbox-custom-field-row">
              <input
                value={drafts[field.id] ?? ""}
                disabled={disabled || !contactId}
                onChange={(e) =>
                  setDrafts((current) => ({ ...current, [field.id]: e.target.value }))
                }
              />
              <button
                type="button"
                className="secondary-button compact"
                disabled={disabled || !contactId || savingId === field.id}
                onClick={() => void saveField(field.id)}
              >
                حفظ
              </button>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
