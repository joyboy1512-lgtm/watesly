import type { CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { pickSiteText, useSiteContent } from "../hooks/useSiteContent";
import LanguageSwitcher from "../components/LanguageSwitcher";
import BrandLogo from "../components/BrandLogo";

export default function LandingPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const { data: site } = useSiteContent();
  if (accessToken) return <Navigate to="/inbox" replace />;

  const branding = site?.branding;
  const display = site?.display;
  const landingStyle = branding
    ? ({
        "--landing-primary": branding.primary_color,
        "--landing-accent": branding.accent_color,
      } as CSSProperties)
    : undefined;

  const features =
    site?.features?.length
      ? site.features
      : [
          { title: t("landing.featureInboxTitle"), desc: t("landing.featureInboxDesc"), icon: "💬" },
          { title: t("landing.featureCampaignsTitle"), desc: t("landing.featureCampaignsDesc"), icon: "👥" },
          { title: t("landing.featureCrmTitle"), desc: t("landing.featureCrmDesc"), icon: "📈" },
          { title: t("landing.featureCatalogTitle"), desc: t("landing.featureCatalogDesc"), icon: "🛒" },
          { title: t("landing.featureAnalyticsTitle"), desc: t("landing.featureAnalyticsDesc"), icon: "📊" },
          { title: t("landing.featureApiTitle"), desc: t("landing.featureApiDesc"), icon: "⚡" },
        ];

  const steps =
    site?.steps?.length
      ? site.steps.map((step, index) => ({ n: String(index + 1), title: step.title, desc: step.desc }))
      : [
          { n: "1", title: t("landing.step1Title"), desc: t("landing.step1Desc") },
          { n: "2", title: t("landing.step2Title"), desc: t("landing.step2Desc") },
          { n: "3", title: t("landing.step3Title"), desc: t("landing.step3Desc") },
        ];

  const stats =
    site?.stats?.length
      ? site.stats
      : [
          { value: t("landing.statWhatsapp"), label: t("landing.statWhatsappLabel") },
          { value: t("landing.statAiCrm"), label: t("landing.statAiCrmLabel") },
          { value: t("landing.statApi"), label: t("landing.statApiLabel") },
          { value: t("landing.statGdpr"), label: t("landing.statGdprLabel") },
        ];

  const mockup = site?.mockup;
  const apiSection = site?.api;
  const txt = (key: string, fallbackKey: string) =>
    pickSiteText(site, "landing", key, t(fallbackKey));

  return (
    <div className="landing-page" style={landingStyle}>
      <header className="landing-nav">
        <Link to="/" className="landing-logo">
          <BrandLogo tone="dark" size="lg" src={branding?.logo_dark_url} alt={branding?.app_name} />
        </Link>
        <nav className="landing-nav-links">
          <a href="#features">{txt("features", "landing.features")}</a>
          <a href="#how">{txt("howItWorks", "landing.howItWorks")}</a>
          <a href="#about">{txt("aboutNav", "landing.aboutNav")}</a>
          <a href="/pricing">{txt("pricingNav", "landing.pricingNav")}</a>
          {(display?.show_api ?? true) && <a href="#api">{txt("api", "landing.api")}</a>}
        </nav>
        <div className="landing-nav-actions">
          <LanguageSwitcher className="landing-lang-switch" />
          <Link to="/login" className="landing-btn-ghost">{txt("signIn", "landing.signIn")}</Link>
          <Link to="/register" className="landing-btn-primary">{txt("getStarted", "landing.getStarted")}</Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">{txt("heroEyebrow", "landing.heroEyebrow")}</p>
          <h1>
            {txt("heroTitle", "landing.heroTitle")}
            <span>{txt("heroTitleAccent", "landing.heroTitleAccent")}</span>
          </h1>
          <p className="landing-lead">{txt("heroLead", "landing.heroLead")}</p>
          <div className="landing-hero-actions">
            <Link to="/register" className="landing-btn-primary landing-btn-lg">{txt("tryPlatform", "landing.tryPlatform")}</Link>
            <a href="#features" className="landing-btn-ghost landing-btn-lg">{txt("exploreFeatures", "landing.exploreFeatures")}</a>
          </div>
          {(display?.show_stats ?? true) && (
            <div className="landing-trust-row">
              {stats.map((item) => (
                <div key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {(display?.show_hero_mockup ?? true) && (
          <div className="landing-hero-visual">
            {branding?.hero_image_url ? (
              <img src={branding.hero_image_url} alt="" className="landing-hero-image" />
            ) : (
              <div className="landing-mockup">
                <div className="landing-mockup-header">
                  <span>{mockup?.title ?? t("landing.mockupTitle")}</span>
                  <span className="landing-pill">{mockup?.pill ?? t("landing.mockupPill")}</span>
                </div>
                <div className="landing-mockup-body">
                  {(mockup?.messages ?? []).map((msg, index) => (
                    <div key={index} className={`landing-chat ${msg.role}`}>{msg.text}</div>
                  ))}
                  {mockup?.deal_card && (
                    <div className="landing-deal-card">
                      <span>{mockup.deal_card.label}</span>
                      <strong>{mockup.deal_card.title}</strong>
                      <em>{mockup.deal_card.note}</em>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {(display?.show_features ?? true) && (
        <section id="features" className="landing-section">
          <div className="landing-section-head">
            <p className="landing-eyebrow">{txt("featuresEyebrow", "landing.featuresEyebrow")}</p>
            <h2>{txt("featuresTitle", "landing.featuresTitle")}</h2>
            <p>{txt("featuresSubtitle", "landing.featuresSubtitle")}</p>
          </div>
          <div className="landing-features-grid">
            {features.map((f) => (
              <article key={f.title} className="landing-feature-card">
                <span className="landing-feature-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {(display?.show_how ?? true) && (
        <section id="how" className="landing-section landing-section-alt">
          <div className="landing-section-head">
            <p className="landing-eyebrow">{txt("howEyebrow", "landing.howEyebrow")}</p>
            <h2>{txt("howTitle", "landing.howTitle")}</h2>
          </div>
          <div className="landing-steps">
            {steps.map((step) => (
              <article key={step.n} className="landing-step">
                <span className="landing-step-num">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section id="about" className="landing-section landing-about">
        <div className="landing-about-grid">
          <div className="landing-about-copy">
            <p className="landing-eyebrow">{txt("aboutEyebrow", "landing.aboutEyebrow")}</p>
            <h2>{txt("aboutTitle", "landing.aboutTitle")}</h2>
            <p className="landing-about-lead">{txt("aboutLead", "landing.aboutLead")}</p>
            <p className="landing-about-mission">{txt("companyMission", "landing.companyMission")}</p>
          </div>
          <div className="landing-company-card">
            <h3>{txt("companyLegal", "landing.companyLegal")}</h3>
            <ul className="landing-company-details">
              <li>{txt("companyProduct", "landing.companyProduct")}</li>
              <li>{txt("companyLocation", "landing.companyLocation")}</li>
              <li>
                <a href={`mailto:${txt("companyEmail", "landing.companyEmail")}`}>
                  {txt("companyEmail", "landing.companyEmail")}
                </a>
              </li>
              <li>
                <a href={`https://${txt("companyWebsite", "landing.companyWebsite")}`} target="_blank" rel="noreferrer">
                  {txt("companyWebsite", "landing.companyWebsite")}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {(display?.show_api ?? true) && (
        <section id="api" className="landing-section">
          <div className="landing-api-grid">
            <div>
              <p className="landing-eyebrow">{txt("apiEyebrow", "landing.apiEyebrow")}</p>
              <h2>{txt("apiTitle", "landing.apiTitle")}</h2>
              <p>{txt("apiBody", "landing.apiBody")}</p>
              <ul className="landing-checklist">
                {(apiSection?.checklist ?? [
                  "GET/POST contacts & CRM deals",
                  "إرسال رسائل عبر API",
                  "Webhooks: message.received, deal.won",
                  "OpenAPI + Swagger",
                ]).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Link to="/register" className="landing-btn-primary">{txt("apiDemo", "landing.apiDemo")}</Link>
            </div>
            <pre className="landing-code" dir="ltr">{apiSection?.code_sample ?? `curl -H "Authorization: Bearer mw_..." \\
  https://api.watesly.com/v1/external/contacts`}</pre>
          </div>
        </section>
      )}

      {(display?.show_cta ?? true) && (
        <section className="landing-cta">
          <h2>{txt("ctaTitle", "landing.ctaTitle")}</h2>
          <p>{txt("ctaBody", "landing.ctaBody")}</p>
          <Link to="/register" className="landing-btn-primary landing-btn-lg landing-btn-light">{txt("enterPlatform", "landing.enterPlatform")}</Link>
        </section>
      )}

      <footer className="landing-footer">
        <div className="landing-footer-grid">
          <div className="landing-footer-col landing-footer-brand">
            <BrandLogo tone="light" size="md" src={branding?.logo_light_url} alt={branding?.app_name} />
            <p>{txt("footerTagline", "landing.footerTagline")}</p>
          </div>
          <div className="landing-footer-col">
            <h4>{txt("aboutNav", "landing.aboutNav")}</h4>
            <p>{txt("footerCompany", "landing.footerCompany")}</p>
            <p>
              <a href={`mailto:${txt("footerContact", "landing.footerContact")}`}>
                {txt("footerContact", "landing.footerContact")}
              </a>
            </p>
          </div>
          <div className="landing-footer-col">
            <h4>{txt("features", "landing.features")}</h4>
            <nav className="landing-footer-links">
              <a href="#features">{txt("features", "landing.features")}</a>
              <a href="#how">{txt("howItWorks", "landing.howItWorks")}</a>
              <a href="#api">{txt("api", "landing.api")}</a>
              <Link to="/pricing">{txt("pricingNav", "landing.pricingNav")}</Link>
            </nav>
          </div>
          <div className="landing-footer-col">
            <h4>{txt("termsLink", "landing.termsLink")}</h4>
            <nav className="landing-footer-links">
              <Link to="/privacy">{txt("privacyLink", "landing.privacyLink")}</Link>
              <Link to="/terms">{txt("termsLink", "landing.termsLink")}</Link>
              <Link to="/register">{txt("getStarted", "landing.getStarted")}</Link>
              <Link to="/login">{txt("signIn", "landing.signIn")}</Link>
            </nav>
          </div>
        </div>
        <small className="landing-footer-rights">
          {(txt("footerRights", "landing.footerRights")).replace("{{year}}", String(new Date().getFullYear()))}
        </small>
      </footer>
    </div>
  );
}
