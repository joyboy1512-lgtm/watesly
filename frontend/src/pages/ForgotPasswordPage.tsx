import type { CSSProperties } from "react";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, formatApiError, silentRequest } from "../lib/api";
import { pickSiteText, useSiteContent } from "../hooks/useSiteContent";
import LanguageSwitcher from "../components/LanguageSwitcher";
import BrandLogo from "../components/BrandLogo";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { data: site } = useSiteContent();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const branding = site?.branding;
  const loginTxt = (key: string, fallbackKey: string) =>
    pickSiteText(site, "login", key, t(fallbackKey));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const response = await api.post(
        "/auth/forgot-password",
        { email: email.trim().toLowerCase() },
        silentRequest
      );
      const message =
        typeof response.data?.message === "string" && response.data.message.trim()
          ? response.data.message
          : t("forgotPassword.success");
      setSuccess(message);
    } catch (err) {
      setError(formatApiError(err, t("forgotPassword.error")));
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
          <h1>{loginTxt("heroTitle", "login.heroTitle")}</h1>
          <p>{t("forgotPassword.heroBody")}</p>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-card-v2">
          <div className="login-card-top">
            <Link to="/login" className="landing-back-link">
              {t("forgotPassword.backToLogin")}
            </Link>
            <LanguageSwitcher className="landing-lang-switch" />
          </div>
          <BrandLogo tone="dark" size="lg" className="login-card-logo" src={branding?.logo_dark_url} alt={branding?.app_name} />
          <span className="eyebrow">{t("forgotPassword.eyebrow")}</span>
          <h2>{t("forgotPassword.title")}</h2>
          <p>{t("forgotPassword.subtitle")}</p>

          {success ? (
            <p className="form-success">{success}</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="field-label">
                <span>{t("login.email")}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="whatsapp-button" disabled={loading}>
                {loading ? t("forgotPassword.loading") : t("forgotPassword.submit")}
              </button>
            </form>
          )}

          <small className="hint-text">
            {t("forgotPassword.remembered")} <Link to="/login">{t("forgotPassword.signInLink")}</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
