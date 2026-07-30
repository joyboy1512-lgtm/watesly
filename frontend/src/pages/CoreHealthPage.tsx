import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

type ModuleHealth = {
  module_name: string;
  instance_id: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  heartbeat_at: string;
  details: Record<string, unknown>;
};

export default function CoreHealthPage() {
  const health = useQuery({
    queryKey: ["module-health"],
    queryFn: async () => (await api.get<ModuleHealth[]>("/core/health/modules")).data,
    refetchInterval: 30000
  });

  return (
    <main className="page page-dashboard">
      <section className="hero-card core-hero">
        <div>
          <span className="eyebrow">MYWAT CORE ENGINE</span>
          <h1>مركز صحة الوحدات</h1>
          <p>مراقبة الوحدات الداخلية دون إظهار تفاصيل تقنية معقدة للمستخدم العادي.</p>
        </div>
      </section>

      <section className="stats-grid premium">
        {["healthy", "degraded", "down", "unknown"].map((status) => (
          <article className="metric-card" key={status}>
            <div>
              <span>{status}</span>
              <strong>
                {(health.data ?? []).filter((item) => item.status === status).length}
              </strong>
              <small>وحدة</small>
            </div>
          </article>
        ))}
      </section>

      <section className="card table-card">
        <h2>الوحدات</h2>
        <table>
          <thead>
            <tr>
              <th>الوحدة</th>
              <th>النسخة/الخادم</th>
              <th>الحالة</th>
              <th>آخر نبضة</th>
            </tr>
          </thead>
          <tbody>
            {(health.data ?? []).map((item) => (
              <tr key={`${item.module_name}-${item.instance_id}`}>
                <td>{item.module_name}</td>
                <td>{item.instance_id}</td>
                <td>
                  <span className={`health-badge ${item.status}`}>{item.status}</span>
                </td>
                <td>{new Date(item.heartbeat_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
