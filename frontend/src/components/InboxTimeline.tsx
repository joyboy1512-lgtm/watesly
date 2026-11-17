import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAppTime } from "../lib/language";

type TimelineItem = {
  id: string;
  kind: "event" | "note";
  event_type: string;
  data: Record<string, unknown>;
  actor_name: string | null;
  created_at: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  "conversation.assigned": "تعيين موظف",
  "conversation.status_changed": "تغيير الحالة",
  "conversation.closed_with_note": "إغلاق بملاحظة",
  "conversation.priority_changed": "تغيير الأولوية",
  "note.created": "ملاحظة داخلية"
};

type Props = { conversationId: string | null };

export default function InboxTimeline({ conversationId }: Props) {
  const query = useQuery({
    queryKey: ["conversation-timeline", conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () =>
      (await api.get<TimelineItem[]>(`/conversations/${conversationId}/timeline`)).data
  });

  return (
    <div className="customer-section">
      <h4>الخط الزمني</h4>
      {query.isLoading && <p className="hint-text">جاري التحميل…</p>}
      {query.isError && <p className="hint-text">تعذر تحميل الأحداث.</p>}
      {!query.isLoading && !(query.data ?? []).length && (
        <p className="hint-text">لا توجد أحداث بعد.</p>
      )}
      <div className="inbox-timeline-list">
        {(query.data ?? []).map((item) => (
          <article key={`${item.kind}-${item.id}`} className="inbox-timeline-item">
            <strong>{EVENT_LABELS[item.event_type] ?? item.event_type}</strong>
            {item.kind === "note" && typeof item.data.body === "string" && (
              <p>{item.data.body}</p>
            )}
            {item.kind === "event" && item.data && Object.keys(item.data).length > 0 && (
              <p className="hint-text">{JSON.stringify(item.data)}</p>
            )}
            <small>
              {item.actor_name ? `${item.actor_name} · ` : ""}
              {item.created_at ? formatAppTime(item.created_at) : ""}
            </small>
          </article>
        ))}
      </div>
    </div>
  );
}
