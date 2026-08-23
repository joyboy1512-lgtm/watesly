import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import BrandLogo from "../components/BrandLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { api } from "../lib/api";
import { formatPlanLimit } from "../lib/planLimits";

type PublicPlan = {
  code: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  max_users: number;
  max_organizations: number;
  max_channels: number;
  included_mac: number;
  over_mac_price_per_100: number;
  trial_days: number;
  allow_multi_organization: boolean;
};

function planFeatures(plan: PublicPlan, t: (key: string) => string): string[] {
  return [
    t("pricing.featureInbox"),
    `${plan.included_mac.toLocaleString()} MAC / ${t("pricing.macCycle")}`,
    `${formatPlanLimit(plan.max_users)} ${t("pricing.users")}`,
    `${formatPlanLimit(plan.max_organizations, t("pricing.unlimitedBranches"))} ${t("pricing.branches")}`,
    `${formatPlanLimit(plan.max_channels)} ${t("pricing.channels")}`,
    `${t("pricing.overMac")}: $${plan.over_mac_price_per_100}/100 MAC`,
    t("pricing.featureCampaigns"),
    t("pricing.featureCrm"),
    t("pricing.multiOrg")
  ];
}

function formatPlanPrice(plan: PublicPlan, t: (key: string) => string): { main: string; suffix: string } {
  if (plan.monthly_price > 0) {
    return { main: plan.monthly_price.toLocaleString(), suffix: `USD ${t("pricing.perMonth")}` };
  }
  if (plan.yearly_price > 0) {
    return { main: plan.yearly_price.toLocaleString(), suffix: `USD ${t("pricing.perYear")}` };
  }
  return { main: t("pricing.contactUs"), suffix: "" };
}

export default function PricingPage() {
  const { t } = useTranslation();
  const plansQuery = useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => (await api.get<PublicPlan[]>("/public/plans")).data,
    retry: 1
  });

  const plans = plansQuery.data ?? [];

  return (
    <main className="page pricing-page">
      <header className="pricing-header">
        <Link to="/" className="landing-logo">
          <BrandLogo tone="dark" size="lg" />
        </Link>
        <div className="landing-nav-actions">
          <LanguageSwitcher className="landing-lang-switch" />
          <Link to="/login" className="landing-btn-ghost">{t("landing.signIn")}</Link>
          <Link to="/register" className="landing-btn-primary">{t("landing.getStarted")}</Link>
        </div>
      </header>
      <section className="landing-section">
        <div className="landing-section-head">
          <p className="landing-eyebrow">{t("pricing.eyebrow")}</p>
          <h2>{t("pricing.title")}</h2>
          <p>{t("pricing.subtitle")}</p>
        </div>

        {plansQuery.isLoading && <p className="hint-text pricing-note">{t("pricing.loading")}</p>}

        {!plansQuery.isLoading && plans.length === 0 && (
          <p className="hint-text pricing-note">{t("pricing.empty")}</p>
        )}

        <div className="pricing-grid">
          {plans.map((plan, index) => {
            const price = formatPlanPrice(plan, t);
            const highlight = index === 0;
            return (
              <article key={plan.code} className={`pricing-card${highlight ? " pricing-card-highlight" : ""}`}>
                <h3>{plan.name}</h3>
                <p className="pricing-price">
                  <strong>{price.main}</strong>
                  {price.suffix && <em>{price.suffix}</em>}
                </p>
                <ul>
                  {planFeatures(plan, t).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link to="/register" className={highlight ? "landing-btn-primary" : "secondary-button"}>
                  {t("pricing.cta")}
                </Link>
              </article>
            );
          })}
        </div>
        <p className="hint-text pricing-note">{t("pricing.macExplain")}</p>
        <p className="hint-text pricing-note">{t("pricing.metaNote")}</p>
      </section>
    </main>
  );
}
