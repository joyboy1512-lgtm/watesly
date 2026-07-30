import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type TrustStatus = {
  encryption_enabled: boolean;
  key_version: number | null;
  active_support_grants: number;
  last_audit_event_at: string | null;
};

type Grant = {
  id: string;
  reason: string;
  scope: string;
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: string;
};

type Audit = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export default function TrustCenterPage() {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [durationHours, setDurationHours] = useState(1);

  const status = useQuery({
    queryKey: ["trust-status"],
    queryFn: async () => (await api.get<TrustStatus>("/trust/status")).data
  });

  const grants = useQuery({
    queryKey: ["support-access"],
    queryFn: async () => (await api.get<Grant[]>("/trust/support-access")).data
  });

  const audits = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => (await api.get<Audit[]>("/trust/audit-logs")).data
  });

  async function enableEncryption() {
    await api.post("/trust/encryption/enable");
    client.invalidateQueries({ queryKey: ["trust-status"] });
    client.invalidateQueries({ queryKey: ["audit-logs"] });
  }

  async function grantAccess(event: FormEvent) {
    event.preventDefault();
    await api.post("/trust/support-access", {
      reason,
      duration_hours: durationHours,
      scope: "diagnostics",
      support_user_id: null
    });
    setReason("");
    client.invalidateQueries({ queryKey: ["support-access"] });
    client.invalidateQueries({ queryKey: ["trust-status"] });
    client.invalidateQueries({ queryKey: ["audit-logs"] });
  }

  async function revoke(grantId: string) {
    await api.post(`/trust/support-access/${grantId}/revoke`);
    client.invalidateQueries({ queryKey: ["support-access"] });
    client.invalidateQueries({ queryKey: ["trust-status"] });
    client.invalidateQueries({ queryKey: ["audit-logs"] });
  }

  return (
    <main className="page page-dashboard">
      <section className="hero-card trust-hero">
        <div>
          <span className="eyebrow">TRUST CENTER</span>
          <h1>مركز الثقة والخصوصية</h1>
          <p>تحكم في التشفير، وصول الدعم، وسجل كل عملية حساسة.</p>
        </div>
        <div className="trust-shield">✓</div>
      </section>

      <section className="stats-grid premium">
        <article className="metric-card">
          <div>
            <span>تشفير الحساب</span>
            <strong>{status.data?.encryption_enabled ? "مفعّل" : "غير مفعّل"}</strong>
            <small>Key version {status.data?.key_version ?? "-"}</small>
          </div>
        </article>
        <article className="metric-card">
          <div>
            <span>صلاحيات الدعم النشطة</span>
            <strong>{status.data?.active_support_grants ?? 0}</strong>
            <small>تنتهي تلقائيًا</small>
          </div>
        </article>
        <article className="metric-card">
          <div>
            <span>آخر نشاط تدقيق</span>
            <strong className="small-metric">
              {status.data?.last_audit_event_at
                ? new Date(status.data.last_audit_event_at).toLocaleString()
                : "-"}
            </strong>
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>تشفير البيانات</h2>
              <p>مفتاح مستقل ومشفّر لكل حساب شركة.</p>
            </div>
          </div>
          <div className="trust-feature">
            <div className="trust-feature-icon">🔐</div>
            <div>
              <h3>Account-level encryption</h3>
              <p>
                عند التفعيل، يتم إنشاء مفتاح بيانات خاص بهذا الحساب، ثم يُشفّر
                المفتاح الرئيسي قبل تخزينه.
              </p>
            </div>
          </div>
          <button
            className="primary-action green"
            onClick={enableEncryption}
            disabled={status.data?.encryption_enabled}
          >
            {status.data?.encryption_enabled ? "التشفير مفعّل" : "تفعيل التشفير"}
          </button>
        </article>

        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>منح الدعم صلاحية مؤقتة</h2>
              <p>لا وصول دائم لفريق Watesly.</p>
            </div>
          </div>
          <form className="stack-form" onSubmit={grantAccess}>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="اشرح المشكلة التي تحتاج مساعدة فيها"
              required
            />
            <select
              value={durationHours}
              onChange={(event) => setDurationHours(Number(event.target.value))}
            >
              <option value={1}>ساعة واحدة</option>
              <option value={2}>ساعتان</option>
              <option value={6}>6 ساعات</option>
              <option value={12}>12 ساعة</option>
              <option value={24}>24 ساعة</option>
            </select>
            <button className="primary-action green" type="submit">
              منح صلاحية مؤقتة
            </button>
          </form>
        </article>
      </section>

      <section className="card table-card">
        <h2>صلاحيات الدعم</h2>
        <table>
          <thead>
            <tr>
              <th>السبب</th>
              <th>النطاق</th>
              <th>البداية</th>
              <th>النهاية</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(grants.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.reason}</td>
                <td>{item.scope}</td>
                <td>{new Date(item.starts_at).toLocaleString()}</td>
                <td>{new Date(item.expires_at).toLocaleString()}</td>
                <td>{item.status}</td>
                <td>
                  {item.status === "active" && (
                    <button className="secondary-button" onClick={() => revoke(item.id)}>
                      إلغاء
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card table-card">
        <h2>سجل التدقيق</h2>
        <table>
          <thead>
            <tr>
              <th>العملية</th>
              <th>المورد</th>
              <th>IP</th>
              <th>الوقت</th>
            </tr>
          </thead>
          <tbody>
            {(audits.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.action}</td>
                <td>{item.resource_type}</td>
                <td>{item.ip_address || "-"}</td>
                <td>{new Date(item.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
