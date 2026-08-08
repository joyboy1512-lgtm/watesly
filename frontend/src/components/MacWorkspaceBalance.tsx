import {
  formatMacBalance,
  formatMacCycleMonth,
  formatMacOverageCharge,
  formatMacUsagePercent,
  macBalanceClass
} from "../lib/macHelpers";

export type MacWorkspaceSummary = {
  cycle_month: string;
  mac_count: number;
  included_mac: number;
  mac_remaining: number;
  is_over_mac: boolean;
  over_mac_count: number;
  estimated_over_mac_charge: number;
  over_mac_price_per_100?: number;
  plan_name?: string;
};

type MacWorkspaceBalanceProps = {
  summary: MacWorkspaceSummary;
  showPolicy?: boolean;
};

export default function MacWorkspaceBalance({ summary, showPolicy = true }: MacWorkspaceBalanceProps) {
  const usagePercent = formatMacUsagePercent(summary.mac_count, summary.included_mac);
  const overageCharge = formatMacOverageCharge(summary.estimated_over_mac_charge, summary.is_over_mac);

  return (
    <>
      <section className="admin-stats-row admin-stats-row-brand mac-workspace-stats">
        <article className="admin-stat-card admin-stat-card-brand">
          <span>الحد الشهري</span>
          <strong>{summary.included_mac.toLocaleString("ar")} MAC</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>المستخدم</span>
          <strong>{summary.mac_count.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>المتبقي</span>
          <strong>{summary.is_over_mac ? "0" : summary.mac_remaining.toLocaleString("ar")}</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>نسبة الاستخدام</span>
          <strong>{usagePercent}%</strong>
        </article>
        <article className="admin-stat-card admin-stat-card-brand">
          <span>تكلفة التجاوز</span>
          <strong className={macBalanceClass(summary.is_over_mac, summary.mac_count, summary.included_mac)}>
            {overageCharge}
          </strong>
        </article>
      </section>

      <section className="card mac-workspace-summary-card">
        <div className="mac-workspace-summary-head">
          <div>
            <h2 className="section-title-sm">رصيد MAC — مساحة العمل</h2>
            <small>
              دورة {formatMacCycleMonth(summary.cycle_month)}
              {summary.plan_name ? ` · ${summary.plan_name}` : ""}
            </small>
          </div>
          <span className={macBalanceClass(summary.is_over_mac, summary.mac_count, summary.included_mac)}>
            {summary.is_over_mac ? `Over MAC +${summary.over_mac_count.toLocaleString("ar")}` : "ضمن الخطة"}
          </span>
        </div>
        <div className="progress-row">
          <span>{formatMacBalance(summary.mac_count, summary.included_mac)}</span>
          <strong>{usagePercent}%</strong>
        </div>
        <div className="progress-track">
          <div style={{ width: `${usagePercent}%` }} />
        </div>
      </section>

      {showPolicy && (
        <section className="card mac-policy-card">
          <h2 className="section-title-sm">سياسة MAC في Watesly</h2>
          <ul className="mac-policy-list">
            <li>كل رقم WhatsApp يتفاعل مع شركتك خلال الشهر = <strong>MAC واحد</strong> — مهما تكرّر التواصل.</li>
            <li>يُحتسب MAC عند: رسالة واردة من العميل، أو رد من Inbox/الموظف/الذكاء الاصطناعي.</li>
            <li>الحملات الجماعية <strong>لا تُحسب MAC</strong> — تُفوتر برسائل الحملة المرسلة فقط.</li>
            <li>إعادة التواصل مع نفس العميل في الشهر التالي = MAC جديد لذلك الشهر.</li>
          </ul>
        </section>
      )}
    </>
  );
}
