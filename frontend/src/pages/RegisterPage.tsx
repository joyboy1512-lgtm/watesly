import type { CSSProperties } from "react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { authStore } from "../stores/auth";
import { pickSiteText, useSiteContent } from "../hooks/useSiteContent";
import LanguageSwitcher from "../components/LanguageSwitcher";
import BrandLogo from "../components/BrandLogo";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default function RegisterPage() {
  const { t } = useTranslation();
  const { data: site } = useSiteContent();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const branding = site?.branding;
  const loginTxt = (key: string, fallbackKey: string) =>
    pickSiteText(site, "login", key, t(fallbackKey));

  const suggestedSlug = useMemo(
    () => slugify(organizationName || accountName || "my-business"),
    [organizationName, accountName]
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const slug = organizationSlug.trim() || suggestedSlug;
    try {
      const response = await api.post("/auth/register", {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        account_name: accountName.trim(),
        organization_name: organizationName.trim(),
        organization_slug: slug,
        country_code: "KW",
        currency_code: "KWD",
        timezone: "Asia/Kuwait",
        preferred_language: "ar"
      });
      authStore.getState().setAccessToken(response.data.access_token);
      navigate("/whatsapp-connect");
    } catch (err: unknown) {
      const detail =
        typeof err === "object" &&
        err !== null &&
        "response" in err &&
        typeof (err as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
          ? (err as { response: { data: { detail: string } } }).response.data.detail
          : "";
      if (detail.includes("registered")) {
        setError(t("register.errorEmailTaken"));
      } else if (detail.includes("conflicts")) {
        setError(t("register.errorConflict"));
      } else {
        setError(t("register.errorGeneric"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section
        className="login-brand-panel"
        style={
          branding
            ? ({
                "--login-primary": branding.primary_color,
                "--login-accent": branding.accent_color,
              } as CSSProperties)
            : undefined
        }
      >
        <div className="login-brand-copy">
          <div className="brand-lockup login-lockup">
            <BrandLogo tone="light" size="hero" className="login-brand-logo" src={branding?.logo_light_url} alt={branding?.app_name} />
          </div>
          <h1>{t("register.heroTitle")}</h1>
          <p>{t("register.heroBody")}</p>
          <div className="login-trust-list">
            <span>{loginTxt("trustCatalog", "login.trustCatalog")}</span>
            <span>{loginTxt("trustInbox", "login.trustInbox")}</span>
          </div>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-card-v2 register-card">
          <div className="login-card-top">
            <Link to="/" className="landing-back-link">{t("login.backToLanding")}</Link>
            <LanguageSwitcher className="landing-lang-switch" />
          </div>
          <BrandLogo tone="dark" size="lg" className="login-card-logo" src={branding?.logo_dark_url} alt={branding?.app_name} />
          <span className="eyebrow">{t("register.eyebrow")}</span>
          <h2>{t("register.title")}</h2>
          <p>{t("register.subtitle")}</p>
          <form onSubmit={handleSubmit}>
            <label className="field-label">
              <span>{t("register.fullName")}</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} />
            </label>
            <label className="field-label">
              <span>{t("register.email")}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="field-label">
              <span>{t("register.password")}</span>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? t("login.hide") : t("login.show")}
                </button>
              </div>
              <small className="hint-text">{t("register.passwordHint")}</small>
            </label>
            <label className="field-label">
              <span>{t("register.accountName")}</span>
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} required minLength={2} />
            </label>
            <label className="field-label">
              <span>{t("register.organizationName")}</span>
              <input
                value={organizationName}
                onChange={(e) => {
                  setOrganizationName(e.target.value);
                  if (!slugTouched) setOrganizationSlug(slugify(e.target.value));
                }}
                required
                minLength={2}
              />
            </label>
            <label className="field-label">
              <span>{t("register.organizationSlug")}</span>
              <input
                dir="ltr"
                value={organizationSlug || suggestedSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setOrganizationSlug(slugify(e.target.value));
                }}
                required
                pattern="^[a-z0-9-]+$"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="whatsapp-button" disabled={loading}>
              {loading ? t("register.loading") : t("register.submit")}
            </button>
          </form>
          <p className="hint-text">
            {t("register.hasAccount")}{" "}
            <Link to="/login">{t("register.signInLink")}</Link>
          </p>
          <small className="hint-text">
            {t("register.legalPrefix")}{" "}
            <Link to="/privacy">{t("register.privacyLink")}</Link>
            {" · "}
            <Link to="/terms">{t("register.termsLink")}</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
