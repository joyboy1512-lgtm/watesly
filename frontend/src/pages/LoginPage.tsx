import type { CSSProperties } from "react";
import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { authStore } from "../stores/auth";
import { pickSiteText, useSiteContent } from "../hooks/useSiteContent";
import LanguageSwitcher from "../components/LanguageSwitcher";
import BrandLogo from "../components/BrandLogo";

export default function LoginPage() {
  const { t } = useTranslation();
  const { data: site } = useSiteContent();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitedSuccess = searchParams.get("invited") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const branding = site?.branding;
  const loginTxt = (key: string, fallbackKey: string) =>
    pickSiteText(site, "login", key, t(fallbackKey));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/auth/login", { email: email.trim().toLowerCase(), password });
      authStore.getState().setAccessToken(response.data.access_token);
      navigate("/inbox");
    } catch {
      setError(t("login.error"));
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
          <p>{loginTxt("heroBody", "login.heroBody")}</p>
          <div className="login-trust-list">
            <span>{loginTxt("trustCatalog", "login.trustCatalog")}</span>
            <span>{loginTxt("trustAi", "login.trustAi")}</span>
            <span>{loginTxt("trustInbox", "login.trustInbox")}</span>
          </div>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-card-v2">
          <div className="login-card-top">
            <Link to="/" className="landing-back-link">{t("login.backToLanding")}</Link>
            <LanguageSwitcher className="landing-lang-switch" />
          </div>
          <BrandLogo tone="dark" size="lg" className="login-card-logo" src={branding?.logo_dark_url} alt={branding?.app_name} />
          <span className="eyebrow">{t("eyebrow.welcomeBack")}</span>
          <h2>{t("login.title")}</h2>
          <p>{t("login.subtitle")}</p>
          {invitedSuccess && (
            <p className="form-success">تم تفعيل حسابك. سجّل الدخول ببريدك وكلمة المرور الجديدة.</p>
          )}
          <form onSubmit={handleSubmit}>
            <label className="field-label">
              <span>{t("login.email")}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="field-label">
              <span>{t("login.password")}</span>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? t("login.hide") : t("login.show")}
                </button>
              </div>
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="whatsapp-button" disabled={loading}>
              {loading ? t("login.loading") : t("login.submit")}
            </button>
          </form>
          <small className="hint-text">
            {t("login.footnote")}{" "}
            <Link to="/register">{t("login.createAccount")}</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
