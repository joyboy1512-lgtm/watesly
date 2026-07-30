import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

type Integration = { id: string; slug: string; name: string; category: string; description: string | null; status: string };

export default function MarketplacePage() {
  const items = useQuery({ queryKey: ["marketplace"], queryFn: async () => (await api.get<Integration[]>("/platform/marketplace")).data });

  return (
    <main className="page">
      <header className="page-header"><h1>Marketplace</h1><p>تكاملات، إضافات، وplugins — الربط الخارجي لاحقاً.</p></header>
      <section className="marketplace-grid">
        {(items.data ?? []).map((item) => (
          <article key={item.id} className="card marketplace-card">
            <h3>{item.name}</h3>
            <small>{item.category}</small>
            <p>{item.description}</p>
            <span className="status-pill">{item.status}</span>
            <button disabled>تثبيت (قريباً)</button>
          </article>
        ))}
      </section>
    </main>
  );
}
