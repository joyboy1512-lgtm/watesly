import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Employee = {
  user_id: string;
  membership_id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  organization_ids: string[];
};

type Organization = { id: string; name: string };

export default function TeamPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [organizationId, setOrganizationId] = useState("");

  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await api.get<Employee[]>("/team/employees")).data
  });

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  async function invite(event: FormEvent) {
    event.preventDefault();
    await api.post("/team/invitations", {
      email,
      role,
      organization_ids: [organizationId]
    });
    setEmail("");
  }

  async function toggleStatus(item: Employee) {
    await api.patch(`/team/employees/${item.membership_id}`, {
      status: item.status === "active" ? "suspended" : "active"
    });
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>الموظفون</h1>
        <p>إدارة أعضاء الفريق وصلاحياتهم.</p>
      </header>

      <section className="card form-card">
        <h2>دعوة موظف</h2>
        <form className="inline-form" onSubmit={invite}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" required />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="agent">Agent</option>
            <option value="viewer">Viewer</option>
          </select>
          <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required>
            <option value="">اختر الفرع</option>
            {(organizations.data ?? []).map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          <button type="submit">إرسال الدعوة</button>
        </form>
      </section>

      <section className="card table-card">
        <table>
          <thead>
            <tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {(employees.data ?? []).map((item) => (
              <tr key={item.membership_id}>
                <td>{item.full_name}</td>
                <td>{item.email}</td>
                <td>{item.role}</td>
                <td>{item.status}</td>
                <td>
                  <button className="secondary-button" onClick={() => toggleStatus(item)}>
                    {item.status === "active" ? "تعطيل" : "تفعيل"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
