import { useTranslation } from "react-i18next";
import { changeAppLanguage } from "../lib/language";

type LanguageSwitcherProps = {
  className?: string;
};

export default function LanguageSwitcher({ className = "sidebar-action" }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();

  return (
    <button
      type="button"
      className={className}
      onClick={() => void changeAppLanguage(i18n.language === "ar" ? "en" : "ar")}
    >
      <span className="language-badge">{i18n.language === "ar" ? "EN" : "AR"}</span>
      <span>{t("language")}</span>
    </button>
  );
}
