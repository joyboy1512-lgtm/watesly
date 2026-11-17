import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { toastStore } from "../stores/toast";

type Suggestion = {
  contact_id: string;
  display_name: string | null;
  external_address: string;
  email: string | null;
  channel_id: string;
  reasons: string[];
};

type Props = {
  contactId: string | null;
  disabled?: boolean;
};

export default function InboxMergeSuggestions({ contactId, disabled }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["merge-suggestions", contactId],
    enabled: Boolean(contactId),
    queryFn: async () =>
      (await api.get<Suggestion[]>(`/contacts/${contactId}/merge-suggestions`)).data
  });

  async function merge(secondaryId: string) {
    if (!contactId) return;
    if (!window.confirm("دمج جهة الاتصال المحددة في الملف الحالي؟")) return;
    try {
      await api.post("/contacts/merge", {
        primary_contact_id: contactId,
        secondary_contact_id: secondaryId
      });
      toastStore.getState().show("تم دمج جهة الاتصال.", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["merge-suggestions", contactId] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["contacts"] })
      ]);
    } catch {
      toastStore.getState().show("تعذر الدمج.", "error");
    }
  }

  if (!contactId) return null;
  if (query.isLoading) {
    return (
      <div className="customer-section">
        <h4>اقتراح دمج</h4>
        <p className="hint-text">جاري الفحص…</p>
      </div>
    );
  }
  if (!(query.data ?? []).length) return null;

  return (
    <div className="customer-section">
      <h4>اقتراح دمج</h4>
      <p className="hint-text">جهات اتصال قد تكون لنفس العميل عبر قنوات مختلفة.</p>
      <div className="inbox-merge-list">
        {(query.data ?? []).map((item) => (
          <article key={item.contact_id} className="inbox-merge-card">
            <strong>{item.display_name || item.external_address}</strong>
            <span dir="ltr">{item.external_address}</span>
            {item.email && <span dir="ltr">{item.email}</span>}
            <small>{item.reasons.join(" · ")}</small>
            <button
              type="button"
              className="secondary-button compact"
              disabled={disabled}
              onClick={() => void merge(item.contact_id)}
            >
              دمج في هذا الملف
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
