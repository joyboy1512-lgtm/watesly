import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Organization = { id: string; name: string };
type Channel = {
  id: string;
  organization_id: string;
  type: string;
  name: string;
  external_id: string | null;
  status: string;
};

export default function ChannelsPage() {
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [type, setType] = useState("whatsapp");
  const [name, setName] = useState("");

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await api.post<Channel>(/channels, {
        organization_id: organizationId,
        type,
        name,
        external_id: null
      });
      setName(");
      await client.invalidateQueries({ queryKey: [channels] });
      await client.invalidateQueries({ queryKey: [channel-stats] });
      toastStore.getState().show(تمت إضافة القناة بنجاح, success);
      if (type === whatsapp) {
        navigate(`/whatsapp-connect?channel=${response.data.id}`);
      }
    } catch (error) {
      const detail = formatApiError(error);
      const msg =
        detail.includes(Channel limit) || detail === CHANNEL_LIMIT_REACHED
          ? وصلت للحد الأقصى من القنوات في خطتك. ترقِّ خطتك لإضافة المزيد.
          : detail.includes(subscription) || detail === NO_ACTIVE_SUBSCRIPTION
            ? يلزم اشتراك نشط لإضافة قناة.
            : detail.includes(Organization) || detail === INVALID_ORGANIZATION
              ? الفرع المحدد غير صالح.
              : detail === MISSING_PERMISSION
                ? ليس لديك صلاحية إضافة قنوات.
                : detail;
      toastStore.getState().show(msg, error);
    }
  }  }

  return (
    <main className="page">
      <header className="page-header"><h1>القنوات</h1><p>إدارة WhatsApp والقنوات المستقبلية.</p></header>

      <section className="card form-card">
        <form className="inline-form" onSubmit={create}>
          <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required>
            <option value="">اختر الفرع</option>
            {(organizations.data ?? []).map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
            <option value="email">Email</option>
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم القناة" required />
          <button type="submit">إضافة قناة</button>
        </form>
      </section>

      <section className="card table-card">
        <table>
          <thead><tr><th>الاسم</th><th>النوع</th><th>الحالة</th><th>External ID</th></tr></thead>
          <tbody>
            {(channels.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td><td>{item.type}</td><td>{item.status}</td><td>{item.external_id ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
