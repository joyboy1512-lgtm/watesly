import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BRAND_LOGO_PATHS, resolveBrandAssetUrl } from "../lib/brandAssets";
import type { PublicSiteContent, SiteBranding } from "../types/siteContent";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

function normalizeBranding(branding: SiteBranding): SiteBranding {
  return {
    ...branding,
    logo_dark_url: resolveBrandAssetUrl(branding.logo_dark_url, BRAND_LOGO_PATHS.dark),
    logo_light_url: resolveBrandAssetUrl(branding.logo_light_url, BRAND_LOGO_PATHS.light),
    icon_url: resolveBrandAssetUrl(branding.icon_url, BRAND_LOGO_PATHS.icon),
  };
}

function normalizeSiteContent(data: PublicSiteContent): PublicSiteContent {
  return {
    ...data,
    branding: normalizeBranding(data.branding),
  };
}

export async function fetchPublicSiteContent(locale: string): Promise<PublicSiteContent> {
  const response = await fetch(`${API_BASE}/public/site-content?locale=${encodeURIComponent(locale)}`);
  if (!response.ok) {
    throw new Error("Unable to load site content");
  }
  const data = (await response.json()) as PublicSiteContent;
  return normalizeSiteContent(data);
}

export function useSiteContent() {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith("en") ? "en" : "ar";

  return useQuery({
    queryKey: ["site-content", locale],
    queryFn: () => fetchPublicSiteContent(locale),
    staleTime: 60_000,
    retry: 1,
  });
}

export function pickSiteText(
  site: PublicSiteContent | undefined,
  section: "landing" | "login",
  key: string,
  fallback: string,
): string {
  const value = site?.[section]?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}
