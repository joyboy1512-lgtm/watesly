import type { CSSProperties } from "react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, formatApiError, silentRequest } from "../lib/api";
import { pickSiteText, useSiteContent } from "../hooks/useSiteContent";
import LanguageSwitcher from "../components/LanguageSwitcher";
import BrandLogo from "../components/BrandLogo";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const { data: site } = useSiteContent();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const branding = site?.branding;
  const loginTxt = (key: string, fallbackKey: string) =>
    pickSiteText(site, "login", key, t(fallbackKey));

  const tokenMissing = useMemo(() => token.length === 0, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (tokenMissing) {
      setError(t("resetPassword.invalidToken"));
      return;
    }
    if (password.length < 6) {
      setError(t("resetPassword.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("resetPassword.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password }, silentRequest);
      navigate("/login?reset=1", { replace: true });
    } catch (err) {
      setError(formatApiError(err, t("resetPassword.error")));
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
          <p>{t("resetPassword.heroBody")}</p>
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
          <span className="eyebrow">{t("resetPassword.eyebrow")}</span>
          <h2>{t("resetPassword.title")}</h2>
          <p>{t("resetPassword.subtitle")}</p>

          {tokenMissing ? (
            <p className="form-error">{t("resetPassword.invalidToken")}</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="field-label">
                <span>{t("resetPassword.password")}</span>
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
                <span>{t("resetPassword.confirmPassword")}</span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="whatsapp-button" disabled={loading}>
                {loading ? t("resetPassword.loading") : t("resetPassword.submit")}
              </button>
            </form>
          )}

          <small className="hint-text">
            {t("resetPassword.requestNew")}{" "}
            <Link to="/forgot-password">{t("resetPassword.requestNewLink")}</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
