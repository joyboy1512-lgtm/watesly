import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Organization = {
  id: string;
  name: string;
  slug: string;
  country_code: string;
  currency_code: string;
  timezone: string;
  default_language: string;
  status: string;
};

export default function OrganizationsPage() {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const query = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  async function create(event: FormEvent) {
    event.preventDefault();
    await api.post("/organizations", {
      name,
      slug,
      country_code: "KW",
      currency_code: "KWD",
      timezone: "Asia/Kuwait",
      default_language: "ar"
    });
    setName("");
    setSlug("");
    client.invalidateQueries({ queryKey: ["organizations"] });
  }

  return (
    <main className="page">
      <header className="page-header"><h1>الفروع</h1><p>إدارة الشركات والفروع داخل الحساب.</p></header>

      <section className="card form-card">
        <form className="inline-form" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الفرع" required />
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="branch-kuwait" required />
          <button type="submit">إضافة فرع</button>
        </form>
      </section>

      <section className="stats-grid">
        {(query.data ?? []).map((item) => (
          <article className="card" key={item.id}>
            <h3>{item.name}</h3>
            <p>{item.country_code} · {item.currency_code}</p>
            <small>{item.status}</small>
          </article>
        ))}
      </section>
    </main>
  );
}
