import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Organization = { id: string; name: string };
type Channel = { id: string; name: string; organization_id: string };
type Employee = { membership_id: string; full_name: string; status: string };
type Team = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  membership_ids: string[];
};
type Rule = {
  id: string;
  name: string;
  strategy: string;
  priority: number;
  team_id: string;
  channel_id: string | null;
  is_active: boolean;
};

export default function AssignmentsPage() {
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [teamId, setTeamId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [strategy, setStrategy] = useState("round_robin");

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await api.get<Channel[]>("/channels")).data
  });
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await api.get<Employee[]>("/team/employees")).data
  });
  const teams = useQuery({
    queryKey: ["assignment-teams"],
    queryFn: async () => (await api.get<Team[]>("/assignments/teams")).data
  });
  const rules = useQuery({
    queryKey: ["assignment-rules"],
    queryFn: async () => (await api.get<Rule[]>("/assignments/rules")).data
  });

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    await api.post("/assignments/teams", {
      organization_id: organizationId,
      name: teamName,
      description: null,
      membership_ids: selectedMembers
    });
    setTeamName("");
    setSelectedMembers([]);
    client.invalidateQueries({ queryKey: ["assignment-teams"] });
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    const team = (teams.data ?? []).find((item) => item.id === teamId);
    if (!team) return;

    await api.post("/assignments/rules", {
      organization_id: team.organization_id,
      channel_id: channelId || null,
      team_id: teamId,
      name: `توزيع ${team.name}`,
      strategy,
      priority: 100,
      is_active: true
    });
    client.invalidateQueries({ queryKey: ["assignment-rules"] });
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>الفرق والتوزيع التلقائي</h1>
        <p>أنشئ فرقًا ووزع المحادثات تلقائيًا بالتناوب أو حسب أقل حمل.</p>
      </header>

      <section className="dashboard-grid">
        <article className="panel-card">
          <h2>إنشاء فريق</h2>
          <form className="stack-form" onSubmit={createTeam}>
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required>
              <option value="">اختر الفرع</option>
              {(organizations.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="اسم الفريق" required />
            <div className="contact-picker">
              {(employees.data ?? []).filter((item) => item.status === "active").map((item) => (
                <label key={item.membership_id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(item.membership_id)}
                    onChange={(e) =>
                      setSelectedMembers((current) =>
                        e.target.checked
                          ? [...current, item.membership_id]
                          : current.filter((id) => id !== item.membership_id)
                      )
                    }
                  />
                  <span>{item.full_name}</span>
                </label>
              ))}
            </div>
            <button className="primary-action green" type="submit">إنشاء الفريق</button>
          </form>
        </article>

        <article className="panel-card">
          <h2>قاعدة توزيع</h2>
          <form className="stack-form" onSubmit={createRule}>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              <option value="">اختر الفريق</option>
              {(teams.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">كل القنوات في الفرع</option>
              {(channels.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="round_robin">Round Robin</option>
              <option value="least_open">الأقل محادثات مفتوحة</option>
            </select>
            <button className="primary-action green" type="submit">حفظ القاعدة</button>
          </form>
        </article>
      </section>

      <section className="card table-card">
        <h2>القواعد النشطة</h2>
        <table>
          <thead>
            <tr><th>الاسم</th><th>الاستراتيجية</th><th>الأولوية</th><th>الحالة</th></tr>
          </thead>
          <tbody>
            {(rules.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.strategy}</td>
                <td>{item.priority}</td>
                <td>{item.is_active ? "نشطة" : "متوقفة"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
