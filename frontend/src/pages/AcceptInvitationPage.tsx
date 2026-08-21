import type { CSSProperties } from "react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, silentRequest } from "../lib/api";
import { pickSiteText, useSiteContent } from "../hooks/useSiteContent";
import { formatInvitationAcceptError } from "../lib/teamHelpers";
import LanguageSwitcher from "../components/LanguageSwitcher";
import BrandLogo from "../components/BrandLogo";

export default function AcceptInvitationPage() {
  const { t } = useTranslation();
  const { data: site } = useSiteContent();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [fullName, setFullName] = useState("");
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
      setError("رابط الدعوة غير صالح. اطلب رابطاً جديداً من مدير الحساب.");
      return;
    }
    if (password.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }

    setLoading(true);
    try {
      await api.post(
        "/team/invitations/accept",
        {
          token,
          full_name: fullName.trim(),
          password,
          preferred_language: "ar"
        },
        silentRequest
      );
      navigate("/login?invited=1", { replace: true });
    } catch (error) {
      setError(formatInvitationAcceptError(error));
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
          <p>أكمل إعداد حسابك للانضمام إلى فريق Watesly.</p>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-card-v2">
          <div className="login-card-top">
            <Link to="/" className="landing-back-link">{t("login.backToLanding")}</Link>
            <LanguageSwitcher className="landing-lang-switch" />
          </div>
          <BrandLogo tone="dark" size="lg" className="login-card-logo" src={branding?.logo_dark_url} alt={branding?.app_name} />
          <span className="eyebrow">دعوة فريق</span>
          <h2>إعداد كلمة المرور</h2>
          <p>اختر اسمك وكلمة مرور لتفعيل حسابك.</p>

          {tokenMissing ? (
            <p className="form-error">رابط الدعوة ناقص أو غير صالح. اطلب رابطاً جديداً من الموظفون → رابط دعوة.</p>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="field-label">
                <span>الاسم الكامل</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  minLength={2}
                  autoComplete="name"
                />
              </label>
              <label className="field-label">
                <span>{t("login.password")}</span>
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
              </label>
              <label className="field-label">
                <span>تأكيد كلمة المرور</span>
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
                {loading ? t("login.loading") : "تفعيل الحساب"}
              </button>
            </form>
          )}

          <small className="hint-text">
            لديك حساب بالفعل؟ <Link to="/login">{t("login.submit")}</Link>
          </small>
        </div>
      </section>
    </main>
  );
}
