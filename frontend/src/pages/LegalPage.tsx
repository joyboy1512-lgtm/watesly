import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BrandLogo from "../components/BrandLogo";
import LanguageSwitcher from "../components/LanguageSwitcher";

type LegalKind = "privacy" | "terms";

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useTranslation();
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? t("legal.privacyTitle") : t("legal.termsTitle");
  const sections = (t(isPrivacy ? "legal.privacySections" : "legal.termsSections", {
    returnObjects: true
  }) || []) as { heading: string; body: string }[];

  return (
    <main className="page legal-page">
      <header className="legal-page-header">
        <Link to="/" className="landing-back-link">{t("login.backToLanding")}</Link>
        <LanguageSwitcher className="landing-lang-switch" />
      </header>
      <article className="card legal-card">
        <BrandLogo tone="dark" size="md" />
        <h1>{title}</h1>
        <p className="hint-text">{t("legal.updated")}</p>
        {sections.map((section) => (
          <section key={section.heading} className="legal-section">
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
        <div className="inline-actions">
          <Link to="/register" className="landing-btn-primary">{t("landing.getStarted")}</Link>
          <Link to="/login" className="secondary-button">{t("landing.signIn")}</Link>
        </div>
      </article>
    </main>
  );
}
