import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BrandLogo from "../components/BrandLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";

const PLANS = [
  {
    id: "starter",
    price: "25",
    currency: "KWD",
    periodKey: "pricing.perMonth",
    highlight: true,
    featureKeys: [
      "pricing.featureInbox",
      "pricing.featureCampaigns",
      "pricing.featureCrm",
      "pricing.featureCatalog",
      "pricing.featureTeam"
    ]
  },
  {
    id: "growth",
    price: "—",
    currency: "",
    periodKey: "pricing.contactUs",
    highlight: false,
    featureKeys: [
      "pricing.featureApi",
      "pricing.featureAutomations",
      "pricing.featureReports",
      "pricing.featureSla",
      "pricing.featureSupport"
    ]
  }
] as const;

export default function PricingPage() {
  const { t } = useTranslation();

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
        <div className="pricing-grid">
          {PLANS.map((plan) => (
            <article key={plan.id} className={`pricing-card${plan.highlight ? " pricing-card-highlight" : ""}`}>
              <h3>{t(`pricing.plan_${plan.id}`)}</h3>
              <p className="pricing-price">
                {plan.price !== "—" && <strong>{plan.price}</strong>}
                {plan.currency && <span>{plan.currency}</span>}
                <em>{t(plan.periodKey)}</em>
              </p>
              <ul>
                {plan.featureKeys.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
              <Link to="/register" className={plan.highlight ? "landing-btn-primary" : "secondary-button"}>
                {t("pricing.cta")}
              </Link>
            </article>
          ))}
        </div>
        <p className="hint-text pricing-note">{t("pricing.metaNote")}</p>
      </section>
    </main>
  );
}
