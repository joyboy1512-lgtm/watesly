import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Account = {
  id: string;
  name: string;
  status: string;
  plan_code: string | null;
  subscription_status: string | null;
};

type Plan = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  max_users: number;
  max_organizations: number;
  max_channels: number;
  included_mac: number;
  over_mac_price_per_100: number;
  status: string;
};

export default function SuperAdminPage() {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const accounts = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: async () => (await api.get<Account[]>("/admin/accounts")).data
  });
  const plans = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => (await api.get<Plan[]>("/admin/plans")).data
  });

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    await api.post("/admin/plans", {
      code,
      name,
      monthly_price: 0,
      yearly_price: 0,
      max_users: 5,
      max_organizations: 1,
      max_channels: 1,
      included_mac: 1000,
      over_mac_price_per_100: 12,
      trial_days: 14,
      allow_multi_organization: false,
      status: "active"
    });
    setCode("");
    setName("");
    client.invalidateQueries({ queryKey: ["admin-plans"] });
  }

  function isAccountActive(status: string) {
    return status.toLowerCase() === "active";
  }

  async function toggleAccount(item: Account) {
    const activating = !isAccountActive(item.status);
    if (!activating) {
      const confirmed = window.confirm(
        `إيقاف حساب «${item.name}»؟\n\nسيتوقف الدخول للموقع بالكامل (Dashboard، Inbox، الكتalog…) حتى يُفعَّل مجدداً.\n\nتأكد أن هذا مقصود.`
      );
      if (!confirmed) return;
    }
    await api.patch(`/admin/accounts/${item.id}`, {
      status: activating ? "active" : "suspended",
      confirm: !activating
    });
    client.invalidateQueries({ queryKey: ["admin-accounts"] });
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Super Admin</h1>
          <p>إدارة حسابات العملاء والباقات.</p>
        </div>
        <Link to="/admin/site-content" className="whatsapp-button">محتوى الموقع</Link>
      </header>

      <section className="card form-card">
        <form className="inline-form" onSubmit={createPlan}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="plan-code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الباقة" required />
          <button type="submit">إنشاء باقة</button>
        </form>
      </section>

      <section className="card table-card">
        <h2>الحسابات</h2>
        <table>
          <thead><tr><th>الحساب</th><th>الباقة</th><th>الاشتراك</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {(accounts.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.plan_code || "-"}</td>
                <td>{item.subscription_status || "-"}</td>
                <td>{item.status}</td>
                <td>
                  <button type="button" className="secondary-button" onClick={() => void toggleAccount(item)}>
                    {isAccountActive(item.status) ? "إيقاف" : "تفعيل"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card table-card">
        <h2>الباقات</h2>
        <table>
          <thead><tr><th>الاسم</th><th>الكود</th><th>المستخدمون</th><th>الفروع</th><th>القنوات</th><th>MAC</th><th>Over MAC</th></tr></thead>
          <tbody>
            {(plans.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.code}</td>
                <td>{item.max_users}</td>
                <td>{item.max_organizations}</td>
                <td>{item.max_channels}</td>
                <td>{item.included_mac?.toLocaleString("ar") ?? "-"}</td>
                <td>${item.over_mac_price_per_100 ?? 0}/100</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
