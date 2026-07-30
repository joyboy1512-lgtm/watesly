import i18n from "../i18n";

export type AppLanguage = "ar" | "en";

export function getAppLanguage(): AppLanguage {
  return i18n.language === "en" ? "en" : "ar";
}

export async function changeAppLanguage(next: AppLanguage) {
  await i18n.changeLanguage(next);
  localStorage.setItem("watesly_language", next);
  document.documentElement.lang = next;
  document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
}

export function formatAppDate(value: string | Date, options: Intl.DateTimeFormatOptions = {}) {
  const locale = getAppLanguage() === "ar" ? "ar" : "en";
  return new Intl.DateTimeFormat(locale, options).format(typeof value === "string" ? new Date(value) : value);
}

export function formatAppDateTime(value: string | Date) {
  return formatAppDate(value, { dateStyle: "short", timeStyle: "short" });
}

export function formatAppTime(value: string | Date) {
  return formatAppDate(value, { hour: "2-digit", minute: "2-digit" });
}
